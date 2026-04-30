import { Router } from "express";
import type { Request } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  CredentialDeviceType,
} from "@simplewebauthn/server";
import { db, usersTable, sessionsTable, webauthnCredentialsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { generateToken } from "../lib/auth";

const router = Router();

// In-memory challenge store: key → { challenge, expiresAt }
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();

function setChallenge(key: string, challenge: string) {
  challengeStore.set(key, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 });
}

function getChallenge(key: string): string | null {
  const entry = challengeStore.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    challengeStore.delete(key);
    return null;
  }
  return entry.challenge;
}

function clearChallenge(key: string) {
  challengeStore.delete(key);
}

function getRpId(req: Request): string {
  const origin = req.headers.origin || req.headers.referer || "";
  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return "localhost";
  }
}

function getOrigin(req: Request): string {
  const origin = req.headers.origin;
  if (origin) return origin;
  const referer = req.headers.referer;
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {}
  }
  return `http://localhost:${process.env["PORT"] || 3000}`;
}

// ── GET /auth/webauthn/has-credential?mobile=XXXXXXXXXX ──
// Check if a user has any biometric credential (no auth required, for login page)
router.get("/auth/webauthn/has-credential", async (req: Request, res): Promise<void> => {
  const mobile = req.query.mobile as string;
  if (!mobile) { res.status(400).json({ error: "mobile required" }); return; }

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.mobile, mobile));
  if (!user) { res.json({ hasCredential: false }); return; }

  const creds = await db.select({ credentialId: webauthnCredentialsTable.credentialId })
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, user.id));

  res.json({ hasCredential: creds.length > 0 });
});

// ── POST /auth/webauthn/register-options ── (requires auth)
router.post("/auth/webauthn/register-options", requireAuth, async (req: Request & { user?: any }, res): Promise<void> => {
  const userId = req.user.id;
  const userName = req.user.name || req.user.mobile;

  const existingCreds = await db.select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, userId));

  const options = await generateRegistrationOptions({
    rpName: "FabricPro",
    rpID: getRpId(req),
    userName,
    userID: new TextEncoder().encode(String(userId)),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
    excludeCredentials: existingCreds.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? JSON.parse(c.transports) as AuthenticatorTransportFuture[] : [],
    })),
  });

  setChallenge(`reg_${userId}`, options.challenge);
  res.json(options);
});

// ── POST /auth/webauthn/register ── (requires auth)
router.post("/auth/webauthn/register", requireAuth, async (req: Request & { user?: any }, res): Promise<void> => {
  const userId = req.user.id;
  const { credential } = req.body;

  if (!credential) { res.status(400).json({ error: "credential required" }); return; }

  const expectedChallenge = getChallenge(`reg_${userId}`);
  if (!expectedChallenge) { res.status(400).json({ error: "Challenge expired, dobara try karo" }); return; }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Verification failed" }); return;
  }

  clearChallenge(`reg_${userId}`);

  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ error: "Biometric verify nahi hua" }); return;
  }

  const { credential: verifiedCred } = verification.registrationInfo;

  await db.insert(webauthnCredentialsTable).values({
    credentialId: verifiedCred.id,
    userId,
    publicKey: Buffer.from(verifiedCred.publicKey).toString("base64"),
    counter: verifiedCred.counter,
    transports: credential.response?.transports ? JSON.stringify(credential.response.transports) : null,
  }).onConflictDoNothing();

  res.json({ success: true, message: "Biometric setup ho gaya!" });
});

// ── POST /auth/webauthn/login-options ── (no auth required)
router.post("/auth/webauthn/login-options", async (req: Request, res): Promise<void> => {
  const { mobile } = req.body;
  if (!mobile) { res.status(400).json({ error: "mobile required" }); return; }

  const [user] = await db.select({ id: usersTable.id, mobile: usersTable.mobile })
    .from(usersTable)
    .where(and(eq(usersTable.mobile, mobile)));
  if (!user) { res.status(404).json({ error: "User nahi mila" }); return; }

  const creds = await db.select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, user.id));

  if (creds.length === 0) {
    res.status(404).json({ error: "Biometric setup nahi hai, password se login karo" }); return;
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(req),
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? JSON.parse(c.transports) as AuthenticatorTransportFuture[] : [],
    })),
  });

  setChallenge(`auth_${mobile}`, options.challenge);
  res.json(options);
});

// ── POST /auth/webauthn/login ── (no auth required)
router.post("/auth/webauthn/login", async (req: Request, res): Promise<void> => {
  const { mobile, credential } = req.body;
  if (!mobile || !credential) { res.status(400).json({ error: "mobile aur credential required" }); return; }

  const expectedChallenge = getChallenge(`auth_${mobile}`);
  if (!expectedChallenge) { res.status(400).json({ error: "Challenge expired, dobara try karo" }); return; }

  const [user] = await db.select()
    .from(usersTable)
    .where(eq(usersTable.mobile, mobile));
  if (!user) { res.status(404).json({ error: "User nahi mila" }); return; }

  const [storedCred] = await db.select()
    .from(webauthnCredentialsTable)
    .where(and(
      eq(webauthnCredentialsTable.userId, user.id),
      eq(webauthnCredentialsTable.credentialId, credential.id)
    ));

  if (!storedCred) { res.status(404).json({ error: "Credential nahi mila" }); return; }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
      credential: {
        id: storedCred.credentialId,
        publicKey: new Uint8Array(Buffer.from(storedCred.publicKey, "base64")),
        counter: storedCred.counter,
        transports: storedCred.transports ? JSON.parse(storedCred.transports) as AuthenticatorTransportFuture[] : [],
      },
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Fingerprint match nahi hua" }); return;
  }

  clearChallenge(`auth_${mobile}`);

  if (!verification.verified) {
    res.status(401).json({ error: "Biometric verify nahi hua" }); return;
  }

  // Update counter
  await db.update(webauthnCredentialsTable)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(webauthnCredentialsTable.credentialId, storedCred.credentialId));

  // Create session
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Deactivate old sessions if limit reached
  const now = new Date();
  const activeSessions = await db.select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.userId, user.id), eq(sessionsTable.isActive, true)));

  for (const s of activeSessions.slice(0, Math.max(0, activeSessions.length - 1))) {
    await db.update(sessionsTable).set({ isActive: false }).where(eq(sessionsTable.id, s.id));
  }

  await db.insert(sessionsTable).values({ userId: user.id, token, expiresAt });

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      mobile: user.mobile,
      code: user.code,
      kycCompleted: user.kycCompleted,
      activationStatus: user.activationStatus,
      role: user.role,
    },
  });
});

// ── DELETE /auth/webauthn/credential ── (requires auth) - remove all biometric credentials
router.delete("/auth/webauthn/credential", requireAuth, async (req: Request & { user?: any }, res): Promise<void> => {
  await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, req.user.id));
  res.json({ success: true, message: "Biometric hata diya gaya" });
});

export default router;
