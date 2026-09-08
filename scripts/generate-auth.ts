import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/auth.js";
import { startLocalPostgres } from "./local-postgres.js";

const local = await startLocalPostgres();
const pool = new Pool({ connectionString: local.adminUrl, max: 1, options: "-c search_path=auth" });
try {
  const auth = createAuth({ origin: "http://127.0.0.1:3000", secret: "schema-generation-only-secret-32-characters", authDatabaseUrl: local.adminUrl, queueDatabaseUrl: local.adminUrl, requireVerification: true, webhookTargets: {} }, pool, async () => {});
  const plan = await getMigrations(auth.options);
  const sql = await plan.compileMigrations();
  await writeFile("migrations/003_auth.sql", `-- 由 Better Auth 1.7.3 生成，认证表归 auth schema。\nSET LOCAL search_path TO auth;\n${sql}\nGRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO sm_core;\n`, "utf8");
  console.log("认证迁移已生成");
} finally { await pool.end(); await local.close(); }
