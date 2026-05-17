import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const app: Express = express();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((pinoHttp as any)({ logger, serializers: { req(req: any) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; }, res(res: any) { return { statusCode: res.statusCode }; } } }));
app.use(cors({ origin: (origin, callback) => { if (!origin) return callback(null, true); const allowed = ["https://fabricpro-frontend.vercel.app","https://fab.naewtgroup.com"]; if (allowed.includes(origin)||origin.endsWith(".vercel.app")||origin.includes("localhost")) return callback(null,true); return callback(null,false); }, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.get("/api/ping", (_req, res) => { res.json({ ok: true }); });

// Schema check
app.get("/api/sys-check-schema", async (_req, res) => {
  try {
    const cols = await db.execute(sql.raw(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position`));
    res.json({ columns: (cols as any).rows?.map((r: any) => r.column_name) });
  } catch(e: any) { res.json({ error: e.message }); }
});

// Full reset + migrate
app.post("/api/sys-migrate-9x7k2", async (_req, res) => {
  const results: { stmt: string; ok: boolean; err?: string }[] = [];
  const run = async (stmt: string) => {
    try { await db.execute(sql.raw(stmt)); results.push({ stmt: stmt.slice(0,50), ok: true }); }
    catch(e: any) { results.push({ stmt: stmt.slice(0,50), ok: false, err: (e.cause?.message||e.message||'').slice(0,120) }); }
  };

  // Drop all tables in correct order
  await run(`DROP TABLE IF EXISTS webauthn_credentials CASCADE`);
  await run(`DROP TABLE IF EXISTS gallery_images CASCADE`);
  await run(`DROP TABLE IF EXISTS app_settings CASCADE`);
  await run(`DROP TABLE IF EXISTS messages CASCADE`);
  await run(`DROP TABLE IF EXISTS notifications CASCADE`);
  await run(`DROP TABLE IF EXISTS payments CASCADE`);
  await run(`DROP TABLE IF EXISTS return_slip_entries CASCADE`);
  await run(`DROP TABLE IF EXISTS return_slips CASCADE`);
  await run(`DROP TABLE IF EXISTS job_slip_items CASCADE`);
  await run(`DROP TABLE IF EXISTS job_slips CASCADE`);
  await run(`DROP TABLE IF EXISTS slips CASCADE`);
  await run(`DROP TABLE IF EXISTS connections CASCADE`);
  await run(`DROP TABLE IF EXISTS sessions CASCADE`);
  await run(`DROP TABLE IF EXISTS otp CASCADE`);
  await run(`DROP TABLE IF EXISTS users CASCADE`);

  // Recreate fresh
  await run(`CREATE TABLE users (id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT, mobile TEXT NOT NULL UNIQUE, email TEXT, role TEXT NOT NULL DEFAULT 'karigar', address TEXT, password TEXT, avatar_url TEXT, aadhaar TEXT, chat_enabled BOOLEAN NOT NULL DEFAULT TRUE, kyc_completed BOOLEAN NOT NULL DEFAULT FALSE, is_online BOOLEAN NOT NULL DEFAULT FALSE, last_seen TIMESTAMPTZ, plan TEXT NOT NULL DEFAULT 'trial', trial_started_at TIMESTAMPTZ, plan_expires_at TIMESTAMPTZ, slips_used INTEGER NOT NULL DEFAULT 0, activation_status TEXT NOT NULL DEFAULT 'active', payment_screenshot TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, location_updated_at TIMESTAMPTZ, wa_token TEXT, wa_token_mode TEXT, wa_token_expiry TIMESTAMPTZ, upi_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ, deleted_by INTEGER)`);
  await run(`CREATE TABLE otp (id SERIAL PRIMARY KEY, mobile TEXT NOT NULL, otp TEXT NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE sessions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), token TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`);
  await run(`CREATE TABLE connections (id SERIAL PRIMARY KEY, from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), role_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE slips (id SERIAL PRIMARY KEY, slip_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), connection_id INTEGER NOT NULL REFERENCES connections(id), description TEXT NOT NULL, quantity NUMERIC, unit TEXT, image_url TEXT, linked_slip_id INTEGER, rate NUMERIC, notes TEXT, payment_bill NUMERIC, paid_amount NUMERIC NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'unpaid', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ)`);
  await run(`CREATE TABLE job_slips (id SERIAL PRIMARY KEY, slip_number TEXT NOT NULL UNIQUE, seth_id INTEGER NOT NULL REFERENCES users(id), karigar_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'sent', notes TEXT, voice_note_url TEXT, paid_amount NUMERIC NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'unpaid', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE job_slip_items (id SERIAL PRIMARY KEY, slip_id INTEGER NOT NULL REFERENCES job_slips(id), item_name TEXT NOT NULL, total_qty INTEGER NOT NULL, rate_per_pc NUMERIC, final_rate NUMERIC, photo_url TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE return_slips (id SERIAL PRIMARY KEY, slip_number TEXT NOT NULL UNIQUE, karigar_id INTEGER NOT NULL REFERENCES users(id), seth_id INTEGER NOT NULL REFERENCES users(id), notes TEXT, voice_note_url TEXT, viewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE return_slip_entries (id SERIAL PRIMARY KEY, return_slip_id INTEGER NOT NULL REFERENCES return_slips(id), job_slip_id INTEGER NOT NULL REFERENCES job_slips(id), jama_qty INTEGER NOT NULL DEFAULT 0, damage_qty INTEGER NOT NULL DEFAULT 0, shortage_qty INTEGER NOT NULL DEFAULT 0, no_work_qty INTEGER NOT NULL DEFAULT 0, rate_per_pc NUMERIC, photo_url TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE payments (id SERIAL PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE, from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), connection_id INTEGER NOT NULL REFERENCES connections(id), amount NUMERIC NOT NULL, note TEXT, screenshot_url TEXT, linked_slip_id INTEGER, job_slip_id INTEGER, final_rate NUMERIC, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, reference_id INTEGER, reference_type TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE messages (id SERIAL PRIMARY KEY, from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL DEFAULT 'text', content TEXT NOT NULL, reply_to_id INTEGER, reply_preview TEXT, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE gallery_images (id SERIAL PRIMARY KEY, uploaded_by INTEGER NOT NULL REFERENCES users(id), thumbnail TEXT NOT NULL, full_image TEXT NOT NULL, caption TEXT, deleted_at TIMESTAMPTZ, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await run(`CREATE TABLE webauthn_credentials (credential_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Demo users
  await run(`INSERT INTO users (code,name,mobile,role,kyc_completed,activation_status) VALUES ('DEMO001','Ramesh Seth','9876543210','seth',true,'active')`);
  await run(`INSERT INTO users (code,name,mobile,role,kyc_completed,activation_status) VALUES ('DEMO002','Suresh Karigar','9876543211','karigar',true,'active')`);
  await run(`INSERT INTO users (code,name,mobile,role,kyc_completed,activation_status) VALUES ('ADMIN01','Admin','9999999999','super_admin',true,'active')`);

  res.json({ done: true, ok: results.filter(r=>r.ok).length, fail: results.filter(r=>!r.ok).length, results });
});

app.use("/api", router);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "error");
  res.status(err.status||500).json({ error: err.message||"Error", cause: err.cause?.message });
});

export default app;
