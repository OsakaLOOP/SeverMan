import { Pool } from "pg";
if (process.getBuiltinModule("fs").existsSync(".env")) process.loadEnvFile(".env");
const email = process.argv[2]?.trim().toLowerCase();
const reserve = process.argv.includes("--reserve");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !process.env.MIGRATION_DATABASE_URL) throw new Error("用法：npm run admin:bootstrap -- 邮箱 [--reserve]，需配置 MIGRATION_DATABASE_URL");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
try {
  await pool.query("BEGIN");
  await pool.query("LOCK TABLE core.admin_account,core.admin_email IN EXCLUSIVE MODE");
  const result = await pool.query('SELECT id FROM auth."user" WHERE lower(email)=$1 AND "emailVerified"=true', [email]);
  if (!reserve && !result.rowCount) throw new Error("请先注册并验证该邮箱，或使用 --reserve 预留权限");
  const existing = await pool.query(`SELECT u.email FROM core.admin_account a JOIN auth."user" u ON u.id::text=a.user_id
    UNION ALL SELECT email FROM core.admin_email`);
  if (existing.rows.some(row => row.email.toLowerCase() !== email)) throw new Error("已有其他管理员，拒绝覆盖");
  await pool.query("INSERT INTO core.admin_email(email) VALUES($1) ON CONFLICT(singleton) DO NOTHING", [email]);
  await pool.query("COMMIT");
  console.log("管理员邮箱已预留；邮箱验证后生效，管理操作仍需二次验证。");
} catch (error) { await pool.query("ROLLBACK"); throw error; }
finally { await pool.end(); }
