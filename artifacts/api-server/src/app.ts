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

// Health check
app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// One-time migration runner — secret protected
app.post("/api/sys-migrate-9x7k2", async (_req, res) => {
  const stmts = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_mode TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_expiry TIMESTAMPTZ`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_preview TEXT`,
    `ALTER TABLE return_slip_entries ADD COLUMN IF NOT EXISTS no_work_qty INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE job_slips ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0`,
    `ALTER TABLE job_slips ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS job_slip_id INTEGER`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_rate NUMERIC`,
    `ALTER TABLE job_slip_items ADD COLUMN IF NOT EXISTS final_rate NUMERIC`,
    `ALTER TABLE slips ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS upi_id TEXT`,
    `CREATE TABLE IF NOT EXISTS webauthn_credentials (
      credential_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];
  const results: { stmt: string; ok: boolean; err?: string }[] = [];
  for (const stmt of stmts) {
    try {
      await db.execute(sql.raw(stmt));
      results.push({ stmt: stmt.slice(0, 60), ok: true });
    } catch (e: any) {
      results.push({ stmt: stmt.slice(0, 60), ok: false, err: e.message });
    }
  }
  res.json({ done: true, results });
});

app.use("/api", router);

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || err.statusCode || 500;
  logger.error({ err }, "Unhandled error");
  res.status(status).json({
    error: err.message || "Internal Server Error",
    cause: err.cause?.message,
    code: err.code,
  });
});

export default app;
