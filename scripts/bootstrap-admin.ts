import { Pool } from "pg";
if (process.getBuiltinModule("fs").existsSync(".env")) process.loadEnvFile(".env");
const email = process.argv[2];
if (!email || !process.env.MIGRATION_DATABASE_URL) throw new Error("用法：npm run admin:bootstrap -- 邮箱，需配置 MIGRATION_DATABASE_URL");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
try {
  const result = await pool.query('SELECT id FROM auth."user" WHERE email=$1 AND "emailVerified"=true', [email]);
  if (!result.rowCount) throw new Error("请先注册并验证该邮箱");
  await pool.query("INSERT INTO core.admin_account(user_id) VALUES($1)", [result.rows[0].id]);
  console.log("唯一管理员已设置，请在安全设置中启用二次验证");
} finally { await pool.end(); }
