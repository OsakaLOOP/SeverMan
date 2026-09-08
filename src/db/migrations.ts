import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

export async function migrate(pool: Pool, directory = resolve("migrations")): Promise<string[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(resolve(directory, name), "utf8");
    return { name, sql, digest: createHash("sha256").update(sql).digest("hex") };
  }));
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    // 使用同一事务串行化迁移检查和执行，失败时整体回滚。
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL ROLE sm_owner");
    await client.query("SELECT pg_advisory_xact_lock(736001)");
    await client.query(`CREATE TABLE IF NOT EXISTS core.schema_migrations (
      name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ name: string; digest: string }>("SELECT name, digest FROM core.schema_migrations ORDER BY name");
    for (const row of applied.rows) {
      const expected = migrations.find((migration) => migration.name === row.name);
      if (!expected || expected.digest !== row.digest) throw new Error(`已应用的迁移缺失或内容变化：${row.name}`);
    }
    const pending = migrations.filter((migration) => !applied.rows.some((row) => row.name === migration.name));
    const latest = applied.rows.at(-1)?.name;
    if (latest && pending.some((migration) => migration.name < latest)) throw new Error("新增迁移必须排在已应用迁移之后");
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query("INSERT INTO core.schema_migrations (name, digest) VALUES ($1, $2)", [migration.name, migration.digest]);
    }
    await client.query("COMMIT");
    return pending.map((migration) => migration.name);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}
