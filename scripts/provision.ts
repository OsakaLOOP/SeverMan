import { Pool } from "pg";

export async function provision(pool: Pool, passwords: { app: string; reader: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(736000)");
    // 标识符均由项目固定，密码通过 PostgreSQL 的字面量转义后用于角色 DDL。
    for (const name of ["sm_owner", "sm_core", "sm_reader", "sm_app", "sm_read"]) {
      const found = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
      if (!found.rowCount) await client.query(`CREATE ROLE ${name} NOLOGIN`);
    }
    for (const [name, password] of [["sm_app", passwords.app], ["sm_read", passwords.reader]] as const) {
      if (password.length < 24) throw new Error("数据库运行账号密码至少 24 个字符");
      const escaped = await client.query<{ value: string }>("SELECT quote_literal($1::text) AS value", [password]);
      await client.query(`ALTER ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${escaped.rows[0]!.value}`);
    }
    await client.query("GRANT sm_core TO sm_app");
    await client.query("GRANT sm_reader TO sm_read");
    await client.query("ALTER ROLE sm_read SET default_transaction_read_only = on");
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query("CREATE SCHEMA IF NOT EXISTS core AUTHORIZATION sm_owner");
    await client.query("CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION sm_owner");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
