import { existsSync } from "node:fs";
import { Pool } from "pg";
import { provision } from "./provision.js";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.MIGRATION_DATABASE_URL || !process.env.APP_DATABASE_PASSWORD || !process.env.READ_DATABASE_PASSWORD) {
  throw new Error("缺少初始化数据库所需的连接地址或运行账号密码");
}
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
try {
  await provision(pool, { app: process.env.APP_DATABASE_PASSWORD, reader: process.env.READ_DATABASE_PASSWORD });
  console.log("数据库基础角色与 schema 已初始化");
} finally {
  await pool.end();
}
