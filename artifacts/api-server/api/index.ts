import app from "../src/app";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

let migrationsDone = false;

async function runMigrations() {
  if (migrationsDone) return;
  migrationsDone = true;
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by INTEGER`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_mode TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_token_expiry TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_preview TEXT`);
    await db.execute(sql`ALTER TABLE return_slip_entries ADD COLUMN IF NOT EXISTS no_work_qty INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE job_slips ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE job_slips ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`);
    await db.execute(sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS job_slip_id INTEGER`);
    await db.execute(sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_rate NUMERIC`);
    await db.execute(sql`ALTER TABLE job_slip_items ADD COLUMN IF NOT EXISTS final_rate NUMERIC`);
    await db.execute(sql`ALTER TABLE slips ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS upi_id TEXT`);
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
    await db.update(usersTable)
      .set({ role: "super_admin", kycCompleted: true, activationStatus: "active" })
      .where(eq(usersTable.mobile, "7905282816"));
  } catch (_e) {}
}

runMigrations().catch(() => {});

export default app;
