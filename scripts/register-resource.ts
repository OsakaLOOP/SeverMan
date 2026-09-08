import { existsSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { Pool } from "pg";
if (existsSync(".env")) process.loadEnvFile(".env");
const file = process.argv[2];
if (!file || !process.env.MIGRATION_DATABASE_URL) throw new Error("用法：npm run resource:register -- resource.json");
const data = JSON.parse(await readFileAsync(file, "utf8")) as { id: string; service_id: string; schema_name: string; view_name: string; user_column: string; sort_column: string; columns: string[] };
const identifiers = [data.schema_name, data.view_name, data.user_column, data.sort_column, ...data.columns];
if (!identifiers.every((value) => /^[a-z][a-z0-9_]*$/.test(value)) || !data.schema_name.startsWith("site_") || !data.columns.includes(data.sort_column)) throw new Error("资源标识符或字段无效");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const view = await client.query("SELECT table_name FROM information_schema.views WHERE table_schema=$1 AND table_name=$2", [data.schema_name, data.view_name]);
  if (!view.rowCount) throw new Error("目标必须是已创建的视图");
  const existing = await client.query("SELECT service_id,schema_name FROM core.resources WHERE id=$1 FOR UPDATE", [data.id]);
  if (existing.rowCount && (existing.rows[0].service_id !== data.service_id || existing.rows[0].schema_name !== data.schema_name)) throw new Error("资源所属服务和 schema 固定，请为新资源使用独立标识");
  await client.query(`SELECT ${identifiers.slice(2).map((name) => `"${name}"`).join(",")} FROM "${data.schema_name}"."${data.view_name}" LIMIT 0`);
  await client.query("INSERT INTO core.resources(id,service_id,schema_name,view_name,user_column,sort_column,columns) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET columns=excluded.columns,view_name=excluded.view_name,user_column=excluded.user_column,sort_column=excluded.sort_column", [data.id, data.service_id, data.schema_name, data.view_name, data.user_column, data.sort_column, data.columns]);
  await client.query(`GRANT USAGE ON SCHEMA "${data.schema_name}" TO sm_reader; GRANT SELECT ON "${data.schema_name}"."${data.view_name}" TO sm_reader`);
  await client.query("COMMIT");
  console.log("只读资源已登记");
} catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); await pool.end(); }
