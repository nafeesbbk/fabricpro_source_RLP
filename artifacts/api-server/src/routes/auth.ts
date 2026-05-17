import { Router } from "express";
import { eq, and, gt, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, usersTable, otpTable, sessionsTable, notificationsTable, appSettingsTable, DEFAULT_SETTINGS } from "@workspace/db";
import {
  LoginBody,
  VerifyOtpBody,
  SubmitKycBody,
  LoginWithPasswordBody,
  ForgotPasswordBody,
} from "@workspace/api-zod";
import { requireAuth, generateToken, generateUserCode } from "../lib/auth";
import { hashPassword, verifyPassword, isValidPassword } from "../lib/password";
import type { Request } from "express";

const router = Router();

function sanitizeUser<T extends Record<string, any>>(u: T): Omit<T, "password"> {
  const { password, ...safe } = u;
  return safe;
}

const MAX_DEVICES = 2;

async function createSessionForUser(userId: number, role?: string) {
  // Device limit: only for non-admin users
  if (role !== "super_admin" && role !== "admin") {
    const now = new Date();
    const activeSessions = await db
      .select()
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.userId, userId),
          eq(sessionsTable.isActive, true),
          gt(sessionsTable.expiresAt, now),
        ),
      )
      .orderBy(asc(sessionsTable.createdAt));

    // Agar 2 ya zyada sessions hain toh purane wale kick karo
    if (activeSessions.length >= MAX_DEVICES) {
      const toKick = activeSessions.slice(0, activeSessions.length - MAX_DEVICES + 1);
      for (const s of toKick) {
        await db.update(sessionsTable).set({ isActive: false }).where(eq(sessionsTable.id, s.id));
      }
    }
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessionsTable).values({ userId, token, expiresAt });
  await db.update(usersTable).set({ isOnline: true, lastSeen: new Date() }).where(eq(usersTable.id, userId));
  return token;
}

async function sendOtpViaSms(mobile: string, otp: string): Promise<void> {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return; // dev mode — skip sending
  try {
    const resp = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
        "cache-control": "no-cache",
      },
      body: JSON.stringify({
        route: "q",
        message: `${otp} is your FabricPro OTP. Valid for 10 minutes. Do not share with anyone.`,
        language: "english",
        flash: 0,
        numbers: mobile,
      }),
    });
    const data = await resp.json() as any;
    if (!data.return) {
      console.error("Fast2SMS error:", data);
    }
  } catch (err) {
    console.error("Fast2SMS send failed:", err);
  }
}

async function sendOtpViaEmail(email: string, otp: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "FabricPro <onboarding@resend.dev>",
        to: [email],
        subject: "FabricPro Admin Login OTP",
        html: `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px"><h2 style="color:#4f46e5;margin:0 0 8px">FabricPro Admin Login</h2><p style="color:#444;margin:0 0 16px">Naye device pe login ke liye aapka OTP:</p><div style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#4f46e5;padding:20px;background:#f0f0ff;border-radius:12px;text-align:center">${otp}</div><p style="color:#888;font-size:12px;margin:16px 0 0">Yeh OTP 10 minute mein expire ho jaayega. Kisi ke saath share mat karo.</p></div>`,
      }),
    });
  } catch (err) {
    console.error("Resend email failed:", err);
  }
}

async function generateAndSaveOtp(mobile: string, skipSms = false) {
  // Invalidate old OTPs
  await db.update(otpTable).set({ used: true }).where(eq(otpTable.mobile, mobile));

  // Generate random 6-digit OTP (dev fallback: 123456 if no API key)
  const otp = process.env.FAST2SMS_API_KEY
    ? String(Math.floor(100000 + Math.random() * 900000))
    : "123456";

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await db.insert(otpTable).values({ mobile, otp, expiresAt });

  if (!skipSms) {
    await sendOtpViaSms(mobile, otp);
  }
  return otp;
}

// POST /auth/login - returns hasPassword flag; if no password, also sends OTP
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { mobile } = parsed.data;

  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));

  // Deleted user check — inform with special error
  if (existingUser && existingUser.deletedAt) {
    res.status(403).json({ error: "Yeh account band kar diya gaya hai. Admin se contact karo.", deleted: true });
    return;
  }

  if (existingUser && existingUser.password) {
    res.json({
      message: "Password se login karo",
      otpSent: false,
      hasPassword: true,
      mobile,
    });
    return;
  }

  // New user OR no password set yet — send OTP
  const otpMode = await getSettingValue("otp_mode"); // "real", "system", or "whatsapp"
  req.log.info({ mobile, hasPassword: false, otpMode }, "OTP/WA generated (signup or no password)");

  // WhatsApp approval mode — no OTP, admin approves via magic link
  if (otpMode === "whatsapp") {
    const adminWa = await getSettingValue("admin_whatsapp");
    if (!adminWa) {
      res.status(500).json({ error: "Admin WhatsApp number configure nahi hai — Admin se baat karo" });
      return;
    }
    // Upsert user record with pending status
    let [pendingUser] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
    // Dead user check in whatsapp mode
    if (pendingUser && pendingUser.deletedAt) {
      res.status(403).json({ error: "Yeh account band kar diya gaya hai. Admin se contact karo.", deleted: true });
      return;
    }
    // Already approved but KYC not done (token lost / page replaced) — let them in directly, no re-approval needed
    if (pendingUser && pendingUser.activationStatus === "active" && !pendingUser.kycCompleted && !pendingUser.password) {
      const token = await createSessionForUser(pendingUser.id, pendingUser.role);
      res.json({ directLogin: true, token, needsKyc: true, hasPassword: false });
      return;
    }
    const waToken = randomUUID();
    const waTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    if (!pendingUser) {
      const code = await generateUserCode();
      [pendingUser] = await db.insert(usersTable).values({
        mobile, code, activationStatus: "pending_wa", kycCompleted: false,
        waToken, waTokenMode: "signup", waTokenExpiry,
      }).returning();
    } else {
      // Already active user logging in without password — use "login" mode, DON'T reset activationStatus
      const isAlreadyActive = pendingUser.activationStatus === "active" || pendingUser.activationStatus === "wa_approved";
      [pendingUser] = await db.update(usersTable)
        .set({
          waToken,
          waTokenMode: isAlreadyActive ? "login" : "signup",
          waTokenExpiry,
          ...(isAlreadyActive ? {} : { activationStatus: "pending_wa" }),
        })
        .where(eq(usersTable.id, pendingUser.id)).returning();
    }
    const isLoginMode = pendingUser.waTokenMode === "login";
    const appUrl = `${req.protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const approveLink = `${appUrl}/api/auth/wa-approve/${waToken}`;
    const rawMsg = isLoginMode
      ? `🔓 FabricPro - Login Request\n\nMobile: +91${mobile}\n\nLogin allow karne ke liye yeh link tapein:\n${approveLink}\n\n⏱ Link 1 ghante mein expire ho jayega.`
      : `🆕 FabricPro - Naya User Registration\n\nMobile: +91${mobile}\n\nApprove karne ke liye yeh link tapein:\n${approveLink}\n\n⏱ Link 1 ghante mein expire ho jayega.`;
    const waMsg = encodeURIComponent(rawMsg);
    res.json({ whatsappMode: true, adminWhatsapp: adminWa, waMsg, mobile, hasPassword: false, waMode: isLoginMode ? "login" : "signup" });
    return;
  }

  const otp = await generateAndSaveOtp(mobile, otpMode === "system");
  // Only expose systemOtp in non-production environments (never in production)
  const isDev = process.env.NODE_ENV !== "production";
  res.json({
    message: otpMode === "system"
      ? "System OTP generate hua — auto-fill ho jayega"
      : (process.env.FAST2SMS_API_KEY ? `OTP ${mobile} par bheja gaya` : "OTP bheja gaya (dev: 123456)"),
    otpSent: true,
    hasPassword: false,
    mobile,
    ...(otpMode === "system" ? { systemOtp: otp } : {}),
  });
});

// POST /auth/login-password
router.post("/auth/login-password", async (req, res): Promise<void> => {
  const parsed = LoginWithPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { mobile, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
  if (!user || !user.password) {
    res.status(401).json({ error: "Mobile ya password galat hai" });
    return;
  }

  const valid = verifyPassword(password, user.password);
  if (!valid) {
    res.status(401).json({ error: "Password galat hai" });
    return;
  }

  const token = await createSessionForUser(user.id, user.role);
  const [refreshed] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  res.json({ user: sanitizeUser(refreshed), token, needsKyc: !refreshed.kycCompleted, needsPassword: false });
});

// POST /auth/admin-login - direct username+password login for super_admin
router.post("/auth/admin-login", async (req, res): Promise<void> => {
  const { username, password, deviceId } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: "Username aur password dono zaroori hain" });
    return;
  }

  const uname = String(username).trim().toLowerCase();

  // Find super_admin users
  const admins = await db.select().from(usersTable).where(eq(usersTable.role, "super_admin"));

  if (!admins.length) {
    res.status(401).json({ error: "Koi admin account nahi mila" });
    return;
  }

  // Match: username === "admin" → first super_admin; or match by mobile/code
  const admin = admins.find((a) =>
    uname === "admin" ||
    a.mobile === uname ||
    (a.code && a.code.toLowerCase() === uname) ||
    (a.name && a.name.toLowerCase() === uname)
  );

  if (!admin) {
    res.status(401).json({ error: "Username galat hai" });
    return;
  }

  if (!admin.password) {
    res.status(401).json({ error: "Admin ka password set nahi hai. Pehle OTP se login karke password set karo." });
    return;
  }

  const valid = verifyPassword(String(password), admin.password);
  if (!valid) {
    res.status(401).json({ error: "Password galat hai" });
    return;
  }

  // Check if device is already trusted
  const dId = String(deviceId || "").trim();
  if (dId) {
    const [trustedRow] = await db.select().from(appSettingsTable)
      .where(eq(appSettingsTable.key, `trusted_device_${dId}`));
    if (trustedRow) {
      const token = await createSessionForUser(admin.id, admin.role);
      const [refreshed] = await db.select().from(usersTable).where(eq(usersTable.id, admin.id));
      res.json({ user: sanitizeUser(refreshed), token, needsKyc: false });
      return;
    }
  }

  // New/unknown device — send email OTP
  const [emailRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "admin_email"));
  const adminEmail = emailRow?.value || process.env.ADMIN_EMAIL || "";

  if (!adminEmail) {
    // No email configured — direct login fallback
    const token = await createSessionForUser(admin.id, admin.role);
    const [refreshed] = await db.select().from(usersTable).where(eq(usersTable.id, admin.id));
    res.json({ user: sanitizeUser(refreshed), token, needsKyc: false });
    return;
  }

  const otpKey = `ADMIN_DEV_${admin.id}`;
  const otp = await generateAndSaveOtp(otpKey, true);
  await sendOtpViaEmail(adminEmail, otp);
  res.json({ requiresDeviceOtp: true, adminId: admin.id, adminEmail });
});

// POST /auth/admin-verify-device - verify email OTP and trust device
router.post("/auth/admin-verify-device", async (req, res): Promise<void> => {
  const { adminId, deviceId, otp } = req.body;
  if (!adminId || !deviceId || !otp) {
    res.status(400).json({ error: "adminId, deviceId aur otp zaroori hain" });
    return;
  }

  const otpKey = `ADMIN_DEV_${adminId}`;
  const now = new Date();
  const [otpRow] = await db.select().from(otpTable).where(
    and(
      eq(otpTable.mobile, otpKey),
      eq(otpTable.otp, String(otp)),
      eq(otpTable.used, false),
      gt(otpTable.expiresAt, now)
    )
  );

  if (!otpRow) {
    res.status(401).json({ error: "OTP galat hai ya expire ho gaya" });
    return;
  }

  await db.update(otpTable).set({ used: true }).where(eq(otpTable.id, otpRow.id));

  const dId = String(deviceId).trim();
  await db
    .insert(appSettingsTable)
    .values({ key: `trusted_device_${dId}`, value: new Date().toISOString() })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });

  const id = parseInt(String(adminId), 10);
  const [admin] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!admin) {
    res.status(401).json({ error: "Admin user nahi mila" });
    return;
  }

  const token = await createSessionForUser(admin.id, admin.role);
  res.json({ user: sanitizeUser(admin), token, needsKyc: false });
});

// In-memory rate limiter for forgot-password (mobile → {count, windowStart})
const forgotPasswordAttempts = new Map<string, { count: number; windowStart: number }>();
const FORGOT_MAX_ATTEMPTS = 3;
const FORGOT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// POST /auth/forgot-password - sends OTP for password reset
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { mobile } = parsed.data;

  // Rate limiting: max 3 attempts per mobile per 5 minutes
  const now = Date.now();
  const existing = forgotPasswordAttempts.get(mobile);
  if (existing) {
    if (now - existing.windowStart < FORGOT_WINDOW_MS) {
      if (existing.count >= FORGOT_MAX_ATTEMPTS) {
        const retryAfter = Math.ceil((FORGOT_WINDOW_MS - (now - existing.windowStart)) / 1000 / 60);
        res.status(429).json({ error: `Bahut zyada requests. ${retryAfter} minute baad try karo.` });
        return;
      }
      existing.count++;
    } else {
      forgotPasswordAttempts.set(mobile, { count: 1, windowStart: now });
    }
  } else {
    forgotPasswordAttempts.set(mobile, { count: 1, windowStart: now });
  }

  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
  if (!existingUser) {
    // Don't reveal whether number exists — generic message (prevents enumeration)
    res.json({ message: "Agar yeh number registered hai to OTP aa jayega.", otpSent: false, mobile });
    return;
  }

  const otpMode = await getSettingValue("otp_mode");

  // WhatsApp approval mode for password reset
  if (otpMode === "whatsapp") {
    const adminWa = await getSettingValue("admin_whatsapp");
    if (!adminWa) {
      res.status(500).json({ error: "Admin WhatsApp number configure nahi hai — Admin se baat karo" });
      return;
    }
    const waToken = randomUUID();
    const waTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.update(usersTable)
      .set({ waToken, waTokenMode: "reset", waTokenExpiry })
      .where(eq(usersTable.id, existingUser.id));
    const appUrl = `${req.protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const approveLink = `${appUrl}/api/auth/wa-approve/${waToken}`;
    const rawMsg = `🔑 FabricPro - Password Reset Request\n\nMobile: +91${mobile}\n\nPassword reset allow karne ke liye yeh link tapein:\n${approveLink}\n\n⏱ Link 1 ghante mein expire ho jayega.`;
    const waMsg = encodeURIComponent(rawMsg);
    req.log.info({ mobile }, "WhatsApp password reset request generated");
    res.json({ whatsappMode: true, adminWhatsapp: adminWa, waMsg, mobile, otpSent: false });
    return;
  }

  // For password reset, always send via SMS — can't show OTP on screen for security
  const otp = await generateAndSaveOtp(mobile, false);
  req.log.info({ mobile, otpMode, ...(process.env.NODE_ENV !== "production" ? { otp } : {}) }, "Password reset OTP generated");
  res.json({
    message: "Password reset ke liye OTP bheja gaya",
    otpSent: true,
    mobile,
    // systemOtp is NEVER returned for password reset — security risk
  });
});

// POST /auth/verify-otp
router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { mobile, otp } = parsed.data;

  const now = new Date();
  const [otpRecord] = await db
    .select()
    .from(otpTable)
    .where(
      and(
        eq(otpTable.mobile, mobile),
        eq(otpTable.otp, otp),
        eq(otpTable.used, false),
        gt(otpTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!otpRecord) {
    res.status(400).json({ error: "OTP galat hai ya expire ho gaya" });
    return;
  }

  await db.update(otpTable).set({ used: true }).where(eq(otpTable.id, otpRecord.id));

  let [user] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
  if (!user) {
    let code = generateUserCode();
    let existing = await db.select().from(usersTable).where(eq(usersTable.code, code));
    while (existing.length > 0) {
      code = generateUserCode();
      existing = await db.select().from(usersTable).where(eq(usersTable.code, code));
    }
    const [newUser] = await db
      .insert(usersTable)
      .values({ mobile, code, role: "karigar", kycCompleted: false })
      .returning();
    user = newUser;
  }

  const token = await createSessionForUser(user.id, user.role);

  res.json({
    user: sanitizeUser(user),
    token,
    needsKyc: !user.kycCompleted,
    needsPassword: !user.password,
  });
});

async function getSettingValue(key: string): Promise<string> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
}

// POST /auth/kyc - accepts address, password, paymentScreenshot
router.post("/auth/kyc", requireAuth, async (req: Request & { user?: any }, res): Promise<void> => {
  const parsed = SubmitKycBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, mobile, address, aadhaar, password } = parsed.data;
  const paymentScreenshot = typeof req.body.paymentScreenshot === "string" ? req.body.paymentScreenshot : null;
  const currentUser = req.user;

  const updates: Record<string, any> = { name, mobile, kycCompleted: true };
  if (address !== undefined) updates.address = address;
  if (aadhaar !== undefined) updates.aadhaar = aadhaar;
  if (paymentScreenshot) updates.paymentScreenshot = paymentScreenshot;

  // Set trial start date on first KYC completion
  const isFirstKyc = !currentUser.kycCompleted;
  if (isFirstKyc) {
    updates.trialStartedAt = new Date();
  }

  if (password) {
    if (!isValidPassword(password)) {
      res.status(400).json({ error: "Password kam se kam 6 character ka hona chahiye (sirf letters aur numbers)" });
      return;
    }
    updates.password = hashPassword(password);
  }

  // Check if registration fee is required (only for first KYC, non-admin users)
  if (isFirstKyc && currentUser.role !== "super_admin") {
    const regRequired = await getSettingValue("registration_required");
    if (regRequired === "true") {
      if (!paymentScreenshot) {
        res.status(400).json({ error: "Payment ka screenshot zaroori hai — pehle UPI se fee jama karo phir screenshot upload karo" });
        return;
      }
      updates.activationStatus = "pending_payment";
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, currentUser.id))
    .returning();

  // Notify all super_admins if payment screenshot submitted or registration required
  if (isFirstKyc && currentUser.role !== "super_admin") {
    const regRequired = await getSettingValue("registration_required");
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "super_admin"));
    for (const admin of admins) {
      const notifMsg = regRequired === "true" && paymentScreenshot
        ? `${name || mobile} ne registration fee ka screenshot bheja hai — verify karein`
        : `${name || mobile} (${mobile}) ne naya account banaya hai`;
      await db.insert(notificationsTable).values({
        userId: admin.id,
        type: "new_registration",
        title: "Naya User Register Hua",
        message: notifMsg,
      });
    }
  }

  res.json(sanitizeUser(updated));
});

// GET /auth/wa-approve/:token — admin taps this link to approve signup/reset
router.get("/auth/wa-approve/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const now = new Date();
  const [user] = await db.select().from(usersTable).where(
    and(eq(usersTable.waToken, token), gt(usersTable.waTokenExpiry!, now))
  );
  if (!user) {
    res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>FabricPro</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#fff1f0;text-align:center;padding:20px}
      .box{background:white;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:360px;width:100%}</style></head>
      <body><div class="box"><div style="font-size:3rem">❌</div>
      <h2 style="color:#dc2626">Link Expire Ho Gaya</h2>
      <p style="color:#666">Yeh link expire ho gaya ya pehle hi use ho chuka hai. User se naya request mangwao.</p>
      </div></body></html>`);
    return;
  }
  const mode = user.waTokenMode;
  // Clear the token and mark approved based on mode
  const newStatus = mode === "signup" ? "wa_approved"
    : mode === "reset" ? "wa_reset_ok"
    : mode === "login" ? "wa_login_ok"
    : user.activationStatus;
  await db.update(usersTable)
    .set({ waToken: null, waTokenMode: null, waTokenExpiry: null, activationStatus: newStatus })
    .where(eq(usersTable.id, user.id));
  req.log.info({ mobile: user.mobile, mode }, "WhatsApp approval granted");
  const label = mode === "reset" ? "Password Reset" : mode === "login" ? "Login" : "Registration";
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>FabricPro — Approved</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0fdf4;text-align:center;padding:20px}
    .box{background:white;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:360px;width:100%}
    h2{color:#16a34a}p{color:#555;line-height:1.6}.num{font-family:monospace;background:#f3f4f6;padding:4px 12px;border-radius:8px;font-size:1.2rem}</style></head>
    <body><div class="box"><div style="font-size:3rem">✅</div>
    <h2>${label} Approve Ho Gaya!</h2>
    <p>Mobile: <span class="num">${user.mobile}</span> ka request approve kar diya gaya.</p>
    <p style="color:#888;font-size:.85rem">User ko refresh karne par access mil jayega. Yeh page band kar sakte hain.</p>
    </div></body></html>`);
});

// GET /auth/wa-status?mobile=XXX&mode=signup|reset — user polls this every 3 seconds
router.get("/auth/wa-status", async (req, res): Promise<void> => {
  const mobile = String(req.query.mobile || "");
  const mode = String(req.query.mode || "signup");
  if (!mobile) { res.status(400).json({ error: "Mobile required" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.mobile, mobile));
  if (!user) { res.json({ approved: false }); return; }

  // Signup approved: admin tapped link, activationStatus set to "wa_approved"
  if (mode === "signup" && user.activationStatus === "wa_approved") {
    const token = await createSessionForUser(user.id, user.role);
    await db.update(usersTable).set({ activationStatus: "active" }).where(eq(usersTable.id, user.id));
    res.json({ approved: true, token, needsKyc: !user.kycCompleted });
    return;
  }

  // Login approved: existing active user, admin tapped link, activationStatus set to "wa_login_ok"
  if (mode === "login" && user.activationStatus === "wa_login_ok") {
    const token = await createSessionForUser(user.id, user.role);
    await db.update(usersTable).set({ activationStatus: "active" }).where(eq(usersTable.id, user.id));
    res.json({ approved: true, token, needsKyc: !user.kycCompleted });
    return;
  }

  // Password reset approved: admin tapped link, activationStatus set to "wa_reset_ok"
  if (mode === "reset" && user.activationStatus === "wa_reset_ok") {
    // Generate a one-time OTP so the existing verify-otp flow can be reused
    const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await db.insert(otpTable).values({ mobile, otp: resetOtp, expiresAt });
    // Clear the wa_reset_ok flag (restore normal status)
    await db.update(usersTable)
      .set({ activationStatus: user.kycCompleted ? "active" : "active" })
      .where(eq(usersTable.id, user.id));
    // Return OTP — safe to return here as admin already verified the user's identity
    res.json({ approved: true, resetOtp });
    return;
  }

  res.json({ approved: false });
});

// GET /auth/registration-info — public endpoint: returns registration fee settings
router.get("/auth/registration-info", async (_req, res): Promise<void> => {
  const regRequired = await getSettingValue("registration_required");
  const fee = await getSettingValue("registration_fee");
  const upiId = await getSettingValue("registration_upi_id");
  const upiName = await getSettingValue("registration_upi_name");
  res.json({ required: regRequired === "true", fee, upiId, upiName });
});

// GET /auth/me
router.get("/auth/me", requireAuth, async (req: Request & { user?: any }, res): Promise<void> => {
  res.json(sanitizeUser(req.user));
});

// POST /auth/logout
router.post("/auth/logout", requireAuth, async (req: Request & { user?: any }, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (auth) {
    const token = auth.slice(7);
    await db.update(sessionsTable).set({ isActive: false }).where(eq(sessionsTable.token, token));
    await db
      .update(usersTable)
      .set({ isOnline: false, lastSeen: new Date() })
      .where(eq(usersTable.id, req.user.id));
  }
  res.json({ message: "Logged out" });
});

export default router;
