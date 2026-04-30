import app from "./app";
import { logger } from "./lib/logger";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function runMigrations() {
  try {
    // users table columns
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by INTEGER`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_mode TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_expiry TIMESTAMPTZ`);
    // messages table — read/delivery receipts + reply support
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_preview TEXT`);
    // return_slip_entries — no-work quantity
    await db.execute(sql`ALTER TABLE return_slip_entries ADD COLUMN IF NOT EXISTS no_work_qty INTEGER NOT NULL DEFAULT 0`);
    // job_slips — payment tracking
    await db.execute(sql`ALTER TABLE job_slips ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE job_slips ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`);
    // payments — job slip link + final rate
    await db.execute(sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS job_slip_id INTEGER`);
    await db.execute(sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_rate NUMERIC`);

    await db.execute(sql`ALTER TABLE job_slip_items ADD COLUMN IF NOT EXISTS final_rate NUMERIC`);
    // slips table — soft delete support
    await db.execute(sql`ALTER TABLE slips ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // webauthn credentials table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        credential_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logger.info("DB migrations applied");
  } catch (e) {
    logger.warn({ err: e }, "Migration failed (non-fatal)");
  }
}

async function seedAdmin() {
  try {
    await db
      .update(usersTable)
      .set({ role: "super_admin", kycCompleted: true, activationStatus: "active" })
      .where(eq(usersTable.mobile, "7905282816"));
    logger.info("Admin user seed applied");
  } catch (e) {
    logger.warn({ err: e }, "Admin seed failed (non-fatal)");
  }
}

runMigrations().then(() => seedAdmin()).then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
});
