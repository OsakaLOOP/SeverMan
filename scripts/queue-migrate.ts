import { PgBoss } from "pg-boss";
import { Pool } from "pg";

export async function migrateQueue(adminUrl: string) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  const boss = new PgBoss({ connectionString: adminUrl, schema: "jobs", max: 1 });
  try {
    await boss.start();
    await boss.createQueue("platform", { retryLimit: 5, retryDelay: 1, retryBackoff: true, expireInSeconds: 30 });
    await pool.query("GRANT USAGE ON SCHEMA jobs TO sm_core; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA jobs TO sm_core; GRANT USAGE ON ALL SEQUENCES IN SCHEMA jobs TO sm_core");
  } finally { await boss.stop(); await pool.end(); }
}
