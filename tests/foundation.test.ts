import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/db/migrations.js";
import { withReadSnapshot } from "../src/db/snapshot.js";
import { startLocalPostgres } from "../scripts/local-postgres.js";

let local: Awaited<ReturnType<typeof startLocalPostgres>>;
let reader: Pool;
let writer: Pool;

before(async () => {
  local = await startLocalPostgres();
  reader = new Pool({ connectionString: local.readDatabaseUrl, max: 1 });
  writer = new Pool({ connectionString: local.databaseUrl, max: 1 });
}, { timeout: 60_000 });

after(async () => {
  await Promise.all([reader?.end(), writer?.end()]);
  await local?.close();
});

test("配置错误不暴露数据库凭据", () => {
  assert.throws(() => readConfig({ DATABASE_URL: "https://secret:password@host/sm", READ_DATABASE_URL: "x" }), (error: unknown) => {
    assert.match(String(error), /DATABASE_URL/);
    assert.doesNotMatch(String(error), /secret|password/);
    return true;
  });
  assert.throws(() => readConfig({ PORT: "3.5" }), /PORT/);
});

test("迁移与健康检查：未迁移返回 503，迁移后返回 200，重复迁移为空", async () => {
  const app = buildApp({ host: "127.0.0.1", port: 3000, logLevel: "silent", databaseUrl: local.databaseUrl, readDatabaseUrl: local.readDatabaseUrl });
  try {
    assert.equal((await app.inject("/health/live")).statusCode, 200);
    assert.equal((await app.inject("/health/ready")).statusCode, 503);
    const applied = await Promise.all([migrate(local.admin), migrate(local.admin)]);
    assert.equal(applied.flat().length, 3);
    assert.equal(applied.flat()[0], "001_services.sql");
    assert.deepEqual(await migrate(local.admin), []);
    const ready = await app.inject("/health/ready");
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.headers["cache-control"], "no-store");
    assert.match(String(ready.headers["x-request-id"]), /^[a-f0-9-]{36}$/);
  } finally { await app.close(); }
});

test("已应用的迁移变化会拒绝继续，迁移失败不会保留部分变更", async () => {
  const directory = await mkdtemp(resolve(".local", "migrations-"));
  const first = await readFile("migrations/001_services.sql", "utf8");
  await writeFile(resolve(directory, "001_services.sql"), first + "\n-- 修改校验\n", "utf8");
  await assert.rejects(migrate(local.admin, directory), /内容变化/);
  await writeFile(resolve(directory, "001_services.sql"), first, "utf8");
  for (const file of ["002_platform.sql", "003_auth.sql"]) await writeFile(resolve(directory, file), await readFile(resolve("migrations", file), "utf8"), "utf8");
  await writeFile(resolve(directory, "004_invalid.sql"), "CREATE TABLE core.should_rollback (id integer); SELECT no_such_column;", "utf8");
  await assert.rejects(migrate(local.admin, directory));
  const result = await local.admin.query("SELECT to_regclass('core.should_rollback') AS name");
  assert.equal(result.rows[0].name, null);
});

test("运行账号只能写本服务表，只读账号只能读取已授权视图", async () => {
  await local.admin.query(`
    CREATE SCHEMA site_a;
    CREATE SCHEMA site_b;
    CREATE TABLE site_a.items (id integer PRIMARY KEY, value integer NOT NULL, private_note text);
    CREATE TABLE site_b.items (id integer PRIMARY KEY, value integer NOT NULL);
    INSERT INTO site_a.items VALUES (1, 10, 'private');
    INSERT INTO site_b.items VALUES (1, 10);
    CREATE VIEW site_a.items_v1 AS SELECT id, value FROM site_a.items;
    CREATE VIEW site_b.items_v1 AS SELECT id, value FROM site_b.items;
    GRANT USAGE ON SCHEMA site_a, site_b TO sm_reader;
    GRANT SELECT ON site_a.items_v1, site_b.items_v1 TO sm_reader;
  `);
  await writer.query("INSERT INTO core.services (id, display_name) VALUES ('site-a', '站点 A')");
  await assert.rejects(writer.query("UPDATE site_a.items SET value = 20"), { code: "42501" });
  await assert.rejects(writer.query("CREATE TABLE core.forbidden (id integer)"), { code: "42501" });
  await assert.rejects(reader.query("SELECT * FROM site_a.items"), { code: "42501" });
  await assert.rejects(reader.query("SELECT * FROM auth.secret"), { code: "42501" });
  // 即使调用方关闭默认只读设置，GRANT 仍应阻止更新可写视图。
  await reader.query("SET default_transaction_read_only = off");
  try { await assert.rejects(reader.query("UPDATE site_a.items_v1 SET value = 20"), { code: "42501" }); }
  finally { await reader.query("SET default_transaction_read_only = on"); }
});

test("跨站只读事务在并发更新前后保持同一快照，新事务读取最新提交", async () => {
  const observed = await withReadSnapshot(reader, async (client) => {
    const a = await client.query("SELECT value FROM site_a.items_v1 WHERE id = 1");
    await local.admin.query("BEGIN; UPDATE site_a.items SET value = 20; UPDATE site_b.items SET value = 20; COMMIT");
    const b = await client.query("SELECT value FROM site_b.items_v1 WHERE id = 1");
    return [a.rows[0].value, b.rows[0].value];
  });
  assert.deepEqual(observed, [10, 10]);
  const fresh = await withReadSnapshot(reader, async (client) => (await client.query("SELECT value FROM site_b.items_v1 WHERE id = 1")).rows[0].value);
  assert.equal(fresh, 20);
  await assert.rejects(withReadSnapshot(reader, async () => { throw new Error("读取中止"); }), /读取中止/);
  assert.equal(reader.totalCount, reader.idleCount);
});

test("数据库不可用时存活检查有效，就绪检查返回 503 且错误不包含连接信息", async () => {
  const app = buildApp({ host: "127.0.0.1", port: 3000, logLevel: "silent", databaseUrl: "postgresql://secret:password@127.0.0.1:1/sm", readDatabaseUrl: "postgresql://secret:password@127.0.0.1:1/sm" });
  try {
    assert.equal((await app.inject("/health/live")).statusCode, 200);
    const result = await app.inject("/health/ready");
    assert.equal(result.statusCode, 503);
    assert.doesNotMatch(result.body, /secret|password|postgresql/);
    assert.equal((await app.inject("/v1/services")).statusCode, 404);
  } finally { await app.close(); }
});
