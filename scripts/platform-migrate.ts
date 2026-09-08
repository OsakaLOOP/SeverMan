import { existsSync } from "node:fs";
import { Pool } from "pg";
import { migrate } from "../src/db/migrations.js";
import { migrateQueue } from "./queue-migrate.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("缺少 MIGRATION_DATABASE_URL");
const pool = new Pool({ connectionString: url, max: 1 });
try { console.log(await migrate(pool)); await migrateQueue(url); } finally { await pool.end(); }
