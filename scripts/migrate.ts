import { existsSync } from "node:fs";
import { Pool } from "pg";
import { migrate } from "../src/db/migrations.js";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.MIGRATION_DATABASE_URL) throw new Error("缺少 MIGRATION_DATABASE_URL");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  const names = await migrate(pool);
  console.log(names.length ? `已应用迁移：${names.join("、")}` : "数据库迁移已是最新");
} finally {
  await pool.end();
}
