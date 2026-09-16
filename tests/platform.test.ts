import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { startLocalPostgres } from "../scripts/local-postgres.js";
import { migrateQueue } from "../scripts/queue-migrate.js";
import { migrate } from "../src/db/migrations.js";
import { buildApp } from "../src/app.js";
import { seal, unseal, signWebhook, verifyWebhook } from "../src/security.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { registerBff } from "../sdk/bff.js";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { Jobs } from "../src/jobs.js";
import { registerCommands } from "../sdk/commands.js";
import type { PlatformConfig } from "../src/platform-config.js";

let local: Awaited<ReturnType<typeof startLocalPostgres>>;
let app: ReturnType<typeof buildApp>;
let alice = ""; let bob = ""; let aliceId = ""; let bobId = "";
const origin = "http://127.0.0.1:3100";
const mail: { to: string; subject: string; text: string; html?: string }[] = [];
let site: ReturnType<typeof Fastify> | undefined;
let siteCookie = "";
const bffSecret = "bff-integration-secret-with-32-characters";
const password = "A-long-test-password-123!";
const targets: PlatformConfig["webhookTargets"] = {};
const config = () => ({ origin, secret: "integration-secret-only-32-characters-long", authDatabaseUrl: local.databaseUrl, queueDatabaseUrl: local.databaseUrl, requireVerification: true, webhookTargets: targets });
const cookies = (response: { cookies: { name: string; value: string }[] }) => response.cookies.filter((item) => item.value).map((item) => `${item.name}=${item.value}`).join("; ");
async function eventually<T>(fn: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 80; i++) { const value = await fn(); if (accepts(value)) return value; await delay(100); }
  throw new Error("等待状态超时");
}
before(async () => {
  local = await startLocalPostgres();
  await migrate(local.admin);
  await migrateQueue(local.adminUrl);
  app = buildApp({ host: "127.0.0.1", port: 3100, logLevel: "silent", databaseUrl: local.databaseUrl, readDatabaseUrl: local.readDatabaseUrl }, {
    config: config(), worker: true, requireAdminTwoFactor: false, captureMail: (item) => mail.push(item),
  });
  await app.listen({ host: "127.0.0.1", port: 3100 });
  for (const name of ["alice", "bob"]) {
    const response = await app.inject({ method: "POST", url: "/api/auth/sign-up/email", headers: { origin }, payload: { name, email: `${name}@example.com`, password: "A-long-test-password-123!" } });
    assert.equal(response.statusCode, 200, response.body);
    const verification = await eventually(async () => mail.find((item) => item.to === `${name}@example.com`), Boolean);
    assert.ok(verification?.html, "邮件应包含 HTML 内容");
    assert.match(verification!.html!, /<a\s+[^>]*href=/i, "HTML 模板应包含超链接");
    const rawUrl = verification!.text.match(/https?:\/\/[^\s]+/)?.[0] ?? verification!.text;
    const verified = await app.inject(new URL(rawUrl).pathname + new URL(rawUrl).search);
    assert.ok([200, 302].includes(verified.statusCode), verified.body);
    const login = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin }, payload: { email: `${name}@example.com`, password } });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = cookies(login);
    if (name === "alice") { alice = cookie; aliceId = response.json().user.id; } else { bob = cookie; bobId = response.json().user.id; }
  }
  await local.admin.query("INSERT INTO core.admin_account(user_id) VALUES($1)", [aliceId]);
}, { timeout: 90_000 });
after(async () => { await site?.close(); await app?.close(); await local?.close(); });

test("统一身份、Origin 和唯一管理员权限", async () => {
  assert.equal((await app.inject("/v1/me")).statusCode, 401);
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: alice } })).json().user.id, aliceId);
  assert.equal((await app.inject({ url: "/v1/admin/services", headers: { cookie: bob } })).statusCode, 403);
  const response = await app.inject({ method: "POST", url: "/v1/sign-out-all", headers: { cookie: alice, origin: "https://evil.example" } });
  assert.equal(response.statusCode, 403);
});

test("服务注册签发独立 OIDC client，并执行授权码与 PKCE 交换", async () => {
  for (const service of ["site-a", "site-b"]) {
    const created = await app.inject({ method: "POST", url: "/v1/admin/services", headers: { cookie: alice, origin }, payload: { id: service, display_name: service, origin: "http://127.0.0.1:4100", redirect_uri: `http://127.0.0.1:4100/${service}/callback` } });
    assert.equal(created.statusCode, 201, created.body);
    const client = created.json();
    assert.ok(client.client_secret);
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: `http://127.0.0.1:4100/${service}/callback`, response_type: "code", scope: "openid profile email", state: "test-state", nonce: "test-nonce", code_challenge: challenge, code_challenge_method: "S256" });
    const authorize = await app.inject({ url: `/api/auth/oauth2/authorize?${params}`, headers: { cookie: alice } });
    assert.equal(authorize.statusCode, 302, authorize.body);
    const callback = new URL(String(authorize.headers.location));
    assert.equal(callback.searchParams.get("state"), "test-state");
    const code = callback.searchParams.get("code");
    assert.ok(code, String(authorize.headers.location));
    const tokenPayload = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `http://127.0.0.1:4100/${service}/callback`, code_verifier: verifier }).toString();
    const token = await app.inject({ method: "POST", url: "/api/auth/oauth2/token", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}` }, payload: tokenPayload });
    assert.equal(token.statusCode, 200, token.body);
    assert.ok(token.json().id_token);
    const info = await app.inject({ url: "/api/auth/oauth2/userinfo", headers: { authorization: `Bearer ${token.json().access_token}` } });
    assert.equal(info.statusCode, 200, info.body);
    assert.equal(info.json().sub, aliceId);
    const reused = await app.inject({ method: "POST", url: "/api/auth/oauth2/token", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}` }, payload: tokenPayload });
    assert.equal(reused.statusCode, 400);
  }
  const metadata = await app.inject("/api/auth/.well-known/openid-configuration");
  assert.equal(metadata.statusCode, 200, metadata.body);
  assert.ok(metadata.json().jwks_uri);
});

test("跨站查询按用户过滤，异步快照持久化并等待指定依赖", async () => {
  await local.admin.query(`CREATE SCHEMA site_data;
    CREATE TABLE site_data.entries(id integer PRIMARY KEY,user_id text NOT NULL,value text);
    CREATE VIEW site_data.entries_v1 AS SELECT * FROM site_data.entries;
    GRANT USAGE ON SCHEMA site_data TO sm_reader; GRANT SELECT ON site_data.entries_v1 TO sm_reader;
    INSERT INTO core.resources VALUES('entries','site-a','site_data','entries_v1','user_id','id',ARRAY['id','value']);`);
  await local.admin.query("INSERT INTO site_data.entries VALUES(1,$1,'alice-private'),(2,$2,'bob-private')", [aliceId, bobId]);
  const response = await app.inject({ method: "POST", url: "/v1/query", headers: { cookie: alice, origin }, payload: { resources: ["entries"] } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.entries.length, 1);
  assert.equal(response.json().data.entries[0].value, "alice-private");
  const submit = () => app.inject({ method: "POST", url: "/v1/operations", headers: { cookie: alice, origin, "idempotency-key": "snapshot-1" }, payload: { kind: "snapshot", resources: ["entries"] } });
  const first = await submit();
  assert.equal(first.statusCode, 202, first.body);
  const id = first.json().id;
  assert.equal((await submit()).json().id, id);
  const conflict = await app.inject({ method: "POST", url: "/v1/operations", headers: { cookie: alice, origin, "idempotency-key": "snapshot-1" }, payload: { kind: "snapshot", resources: ["other"] } });
  assert.equal(conflict.statusCode, 409);
  assert.equal((await app.inject({ url: `/v1/operations/${id}`, headers: { cookie: bob } })).statusCode, 404);
  let status = "pending";
  for (let i = 0; i < 40; i++) {
    status = (await app.inject({ url: `/v1/operations/${id}`, headers: { cookie: alice } })).json().status;
    if (status === "succeeded") break;
    await delay(250);
  }
  assert.equal(status, "succeeded");
  const after = await app.inject({ method: "POST", url: "/v1/query", headers: { cookie: alice, origin }, payload: { resources: ["entries"], after_operation_id: id } });
  assert.equal(after.statusCode, 200, after.body);
});

test("签名时效和加密校验，外部服务未配置时返回明确状态", async () => {
  const secret = "test-encryption-key";
  assert.deepEqual(unseal(seal({ key: 1 }, secret), secret), { key: 1 });
  assert.throws(() => unseal(seal({ key: 1 }, secret), "other"));
  const ts = Math.floor(Date.now() / 1000);
  const signature = signWebhook("body", "event", ts, secret);
  assert.equal(verifyWebhook("body", "event", ts, signature, secret), true);
  assert.equal(verifyWebhook("changed", "event", ts, signature, secret), false);
  assert.equal(verifyWebhook("body", "event", ts, signature, secret, Date.now() + 600_000), false);
  const upload = await app.inject({ method: "POST", url: "/v1/uploads", headers: { cookie: alice, origin }, payload: { content_type: "image/png", size: 100 } });
  assert.equal(upload.statusCode, 503);
  const billing = await app.inject({ method: "POST", url: "/v1/billing/checkout", headers: { cookie: alice, origin, "idempotency-key": "payment" }, payload: { price_id: "test" } });
  assert.equal(billing.statusCode, 404);
});

test("BFF 真实 HTTP 登录、错误 state、续期轮换与本站退出", async () => {
  await local.admin.query(await readFile("examples/site/migration.sql", "utf8"));
  const created = await app.inject({ method: "POST", url: "/v1/admin/services", headers: { cookie: alice, origin }, payload: { id: "site-bff", display_name: "BFF", origin: "http://127.0.0.1:4101", redirect_uri: "http://127.0.0.1:4101/auth/callback" } });
  assert.equal(created.statusCode, 201, created.body);
  const client = created.json();
  site = Fastify();
  await registerBff(site, { issuer: `${origin}/api/auth`, origin: "http://127.0.0.1:4101", clientId: client.client_id, clientSecret: client.client_secret, secret: bffSecret, pool: local.admin, schema: "site_example" });
  await registerCommands(site, { schema: "site_example", secret: bffSecret, pool: local.admin, handlers: { "notes.create": async (transaction, userId, data) => (await transaction.query("INSERT INTO site_example.notes(user_id,title) VALUES($1,$2) RETURNING id,version", [userId, data.title])).rows[0] } });
  await site.listen({ host: "127.0.0.1", port: 4101 });
  const login = await site.inject("/auth/login");
  const authUrl = new URL(String(login.headers.location));
  const authorization = await app.inject({ url: authUrl.pathname + authUrl.search, headers: { cookie: alice } });
  const callback = new URL(String(authorization.headers.location));
  const tampered = new URL(callback); tampered.searchParams.set("state", "wrong");
  assert.equal((await site.inject({ url: tampered.pathname + tampered.search, headers: { cookie: cookies(login) } })).statusCode, 400);
  const exchanged = await site.inject({ url: callback.pathname + callback.search, headers: { cookie: cookies(login) } });
  assert.equal(exchanged.statusCode, 302, exchanged.body);
  siteCookie = cookies(exchanged);
  assert.equal((await site.inject({ url: "/auth/me", headers: { cookie: siteCookie } })).json().id, aliceId);
  const stored = (await local.admin.query("SELECT * FROM site_example.sessions LIMIT 1")).rows[0];
  const tokens = unseal<Record<string, unknown>>(stored.tokens, bffSecret);
  assert.ok(tokens.refresh_token);
  tokens.expires_at = 0;
  await local.admin.query("UPDATE site_example.sessions SET tokens=$1,checked_at=now()-interval '1 minute'", [seal(tokens, bffSecret)]);
  const renewed = await site.inject({ url: "/auth/me", headers: { cookie: siteCookie } });
  assert.equal(renewed.statusCode, 200, renewed.body);
  const refreshed = unseal<Record<string, unknown>>((await local.admin.query("SELECT tokens FROM site_example.sessions LIMIT 1")).rows[0].tokens, bffSecret);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);
  assert.equal((await site.inject({ method: "POST", url: "/auth/logout", headers: { cookie: siteCookie, origin: "https://evil.example" } })).statusCode, 403);
});

test("签名命令提交后读取、重复投递与正文冲突", async () => {
  targets.notes = { url: "http://127.0.0.1:4101/internal/commands", secret: bffSecret, commands: { "notes.create": "user" } };
  await local.admin.query("GRANT USAGE ON SCHEMA site_example TO sm_reader; GRANT SELECT ON site_example.notes_v1 TO sm_reader; INSERT INTO core.resources VALUES('notes','site-bff','site_example','notes_v1','user_id','id',ARRAY['id','title','version'])");
  const submitted = await app.inject({ method: "POST", url: "/v1/operations", headers: { cookie: alice, origin, "idempotency-key": "command-1" }, payload: { kind: "command", target: "notes", command: "notes.create", data: { title: "已提交笔记" } } });
  assert.equal(submitted.statusCode, 202, submitted.body);
  const id = submitted.json().id;
  const query = await app.inject({ method: "POST", url: "/v1/query", headers: { cookie: alice, origin }, payload: { resources: ["notes"], after_operation_id: id } });
  assert.equal(query.statusCode, 200, query.body);
  assert.equal(query.json().data.notes[0].title, "已提交笔记");
  const body = JSON.stringify({ id, data: { title: "已提交笔记" }, user_id: aliceId, command: "notes.create" });
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = { "content-type": "application/json", "x-event-id": id, "x-timestamp": String(timestamp), "x-signature": signWebhook(body, id, timestamp, bffSecret) };
  assert.equal((await site!.inject({ method: "POST", url: "/internal/commands", headers, payload: body })).statusCode, 200);
  assert.equal((await local.admin.query("SELECT count(*)::int AS count FROM site_example.notes")).rows[0].count, 1);
  const changed = body.replace("已提交笔记", "修改正文");
  assert.equal((await site!.inject({ method: "POST", url: "/internal/commands", headers: { ...headers, "x-signature": signWebhook(changed, id, timestamp, bffSecret) }, payload: changed })).statusCode, 409);
  assert.equal((await site!.inject({ method: "POST", url: "/internal/commands", headers, payload: changed })).statusCode, 401);
});

test("邮件重置、二次验证与一次性恢复码", async () => {
  const reset = await app.inject({ method: "POST", url: "/api/auth/request-password-reset", headers: { origin }, payload: { email: "bob@example.com", redirectTo: `${origin}/reset-password` } });
  assert.equal(reset.statusCode, 200, reset.body);
  const email = await eventually(async () => mail.find((item) => item.to === "bob@example.com" && item.subject === "重置密码"), Boolean);
  assert.ok(email?.html, "重置密码邮件应包含 HTML 内容");
  assert.match(email!.html!, /<a\s+[^>]*href=/i, "重置密码 HTML 模板应包含超链接");
  const rawResetUrl = email!.text.match(/https?:\/\/[^\s]+/)?.[0] ?? email!.text;
  const resetLink = new URL(rawResetUrl);
  const redirect = await app.inject(resetLink.pathname + resetLink.search);
  const token = new URL(String(redirect.headers.location)).searchParams.get("token");
  const newPassword = "Changed-test-password-987!";
  const changed = await app.inject({ method: "POST", url: "/api/auth/reset-password", headers: { origin }, payload: { newPassword, token } });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: bob } })).statusCode, 401);
  const login = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin }, payload: { email: "bob@example.com", password: newPassword } });
  bob = cookies(login);
  const enable = await app.inject({ method: "POST", url: "/api/auth/two-factor/enable", headers: { cookie: bob, origin }, payload: { password: newPassword } });
  assert.equal(enable.statusCode, 200, enable.body);
  const otpSecret = new TextDecoder().decode(base32.decode(new URL(enable.json().totpURI).searchParams.get("secret")!));
  const verified = await app.inject({ method: "POST", url: "/api/auth/two-factor/verify-totp", headers: { cookie: bob, origin }, payload: { code: await createOTP(otpSecret).totp() } });
  assert.equal(verified.statusCode, 200, verified.body);
  const second = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", remoteAddress: "127.0.0.2", headers: { origin }, payload: { email: "bob@example.com", password: newPassword } });
  assert.equal(second.json().twoFactorRedirect, true, second.body);
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: cookies(second) } })).statusCode, 401);
  const backup = await app.inject({ method: "POST", url: "/api/auth/two-factor/verify-backup-code", headers: { cookie: cookies(second), origin }, payload: { code: enable.json().backupCodes[0] } });
  assert.equal(backup.statusCode, 200, backup.body);
  const reused = await app.inject({ method: "POST", url: "/api/auth/two-factor/verify-backup-code", headers: { cookie: cookies(backup), origin }, payload: { code: enable.json().backupCodes[0] } });
  assert.equal(reused.statusCode, 401, reused.body);
});

test("工作进程恢复过期执行、依赖失败传播和重试耗尽", async () => {
  const parent = randomUUID(); const child = randomUUID(); const exhausted = randomUUID();
  for (const [id, status, attempts] of [[parent, "running", 1], [child, "pending", 0], [exhausted, "running", 6]] as const) {
    await local.admin.query(`INSERT INTO core.operations(id,user_id,kind,idempotency_key,request_digest,payload,status,attempts,lease_until,updated_at)
      VALUES($1::uuid,$2,'snapshot',$1::text,'test','{"resources":["entries"]}',$3,$4,now()-interval '1 minute',now()-interval '2 minutes')`, [id, aliceId, status, attempts]);
  }
  await local.admin.query("INSERT INTO core.operation_dependencies VALUES($1,$2)", [child, exhausted]);
  const jobs = new Jobs(local.admin, local.admin, config());
  try {
    await jobs.start(true);
    assert.equal((await eventually(() => jobs.get(parent, aliceId), (op) => op.status === "succeeded")).attempts, 2);
    assert.equal((await eventually(() => jobs.get(child, aliceId), (op) => op.status === "failed")).error_code, "DEPENDENCY_FAILED");
    assert.equal((await jobs.get(exhausted, aliceId)).error_code, "RETRY_EXHAUSTED");
  } finally { await jobs.stop(); }
});

test("全站撤销后中心与 BFF 会话无法继续访问", async () => {
  assert.equal((await app.inject({ method: "POST", url: "/v1/sign-out-all", headers: { cookie: alice, origin } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: alice } })).statusCode, 401);
  await local.admin.query("UPDATE site_example.sessions SET checked_at=now()-interval '31 seconds'");
  assert.equal((await site!.inject({ url: "/auth/me", headers: { cookie: siteCookie } })).statusCode, 401);
});
