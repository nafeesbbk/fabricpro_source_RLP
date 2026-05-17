import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const app: Express = express();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(
  (pinoHttp as any)({
    logger,
    serializers: {
      req(req: any) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res: any) { return { statusCode: res.statusCode }; },
    },
  }),
);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ["https://fabricpro-frontend.vercel.app", "https://fab.naewtgroup.com"];
    if (allowed.includes(origin) || origin.endsWith(".vercel.app") || origin.includes("localhost")) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.get("/api/ping", (_req, res) => { res.json({ ok: true, ts: Date.now() }); });

app.post("/api/sys-migrate-9x7k2", async (_req, res) => {
  const stmts = [
    // Ensure all tables exist
    `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT, mobile TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'karigar', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS otp (id SERIAL PRIMARY KEY, mobile TEXT NOT NULL, otp TEXT NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), token TEXT NOT NULL UNIQUE, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS connections (id SERIAL PRIMARY KEY, from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), role_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS slips (id SERIAL PRIMARY KEY, slip_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), connection_id INTEGER NOT NULL REFERENCES connections(id), description TEXT NOT NULL, quantity NUMERIC, unit TEXT, image_url TEXT, linked_slip_id INTEGER, rate NUMERIC, notes TEXT, payment_bill NUMERIC, paid_amount NUMERIC NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'unpaid', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
    `CREATE TABLE IF NOT EXISTS job_slips (id SERIAL PRIMARY KEY, slip_number TEXT NOT NULL UNIQUE, seth_id INTEGER NOT NULL REFERENCES users(id), karigar_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'sent', notes TEXT, voice_note_url TEXT, paid_amount NUMERIC NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'unpaid', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS job_slip_items (id SERIAL PRIMARY KEY, slip_id INTEGER NOT NULL REFERENCES job_slips(id), item_name TEXT NOT NULL, total_qty INTEGER NOT NULL, rate_per_pc NUMERIC, final_rate NUMERIC, photo_url TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS return_slips (id SERIAL PRIMARY KEY, slip_number TEXT NOT NULL UNIQUE, karigar_id INTEGER NOT NULL REFERENCES users(id), seth_id INTEGER NOT NULL REFERENCES users(id), notes TEXT, voice_note_url TEXT, viewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS return_slip_entries (id SERIAL PRIMARY KEY, return_slip_id INTEGER NOT NULL REFERENCES return_slips(id), job_slip_id INTEGER NOT NULL REFERENCES job_slips(id), jama_qty INTEGER NOT NULL DEFAULT 0, damage_qty INTEGER NOT NULL DEFAULT 0, shortage_qty INTEGER NOT NULL DEFAULT 0, no_work_qty INTEGER NOT NULL DEFAULT 0, rate_per_pc NUMERIC, photo_url TEXT, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE, from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), connection_id INTEGER NOT NULL REFERENCES connections(id), amount NUMERIC NOT NULL, note TEXT, screenshot_url TEXT, linked_slip_id INTEGER, job_slip_id INTEGER, final_rate NUMERIC, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, reference_id INTEGER, reference_type TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, from_user_id INTEGER NOT NULL REFERENCES users(id), to_user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL DEFAULT 'text', content TEXT NOT NULL, reply_to_id INTEGER, reply_preview TEXT, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS gallery_images (id SERIAL PRIMARY KEY, uploaded_by INTEGER NOT NULL REFERENCES users(id), thumbnail TEXT NOT NULL, full_image TEXT NOT NULL, caption TEXT, deleted_at TIMESTAMPTZ, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS webauthn_credentials (credential_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    // Add ALL missing columns to users
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS code TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhaar TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_completed BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS slips_used INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_screenshot TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_mode TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_expiry TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS upi_id TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by INTEGER`,
    // Make code unique (ignore if constraint exists)
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_code_key') THEN ALTER TABLE users ADD CONSTRAINT users_code_key UNIQUE (code); END IF; END $$`,
    // Disable RLS
    `ALTER TABLE users DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE otp DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE sessions DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE connections DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE slips DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE job_slips DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE job_slip_items DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE return_slips DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE return_slip_entries DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE payments DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE notifications DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE messages DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE app_settings DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE gallery_images DISABLE ROW LEVEL SECURITY`,
    `ALTER TABLE webauthn_credentials DISABLE ROW LEVEL SECURITY`,
    // Demo users
    `INSERT INTO users (code,name,mobile,role,kyc_completed,activation_status,plan) VALUES ('DEMO001','Ramesh Seth','9876543210','seth',true,'active','trial') ON CONFLICT (mobile) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, role=EXCLUDED.role, kyc_completed=EXCLUDED.kyc_completed`,
    `INSERT INTO users (code,name,mobile,role,kyc_completed,activation_status,plan) VALUES ('DEMO002','Suresh Karigar','9876543211','karigar',true,'active','trial') ON CONFLICT (mobile) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, role=EXCLUDED.role, kyc_completed=EXCLUDED.kyc_completed`,
    `INSERT INTO users (code,name,mobile,role,kyc_completed,activation_status,plan) VALUES ('ADMIN01','Admin','9999999999','super_admin',true,'active','trial') ON CONFLICT (mobile) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, role=EXCLUDED.role, kyc_completed=EXCLUDED.kyc_completed`,
  ];
  const results: { stmt: string; ok: boolean; err?: string }[] = [];
  for (const stmt of stmts) {
    try {
      await db.execute(sql.raw(stmt));
      results.push({ stmt: stmt.slice(0, 50), ok: true });
    } catch (e: any) {
      results.push({ stmt: stmt.slice(0, 50), ok: false, err: e.message?.slice(0, 120) });
    }
  }
  res.json({ done: true, results });
});

app.use("/api", router);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || err.statusCode || 500;
  logger.error({ err }, "Unhandled error");
  res.status(status).json({ error: err.message || "Internal Server Error", cause: err.cause?.message });
});

export default app;
