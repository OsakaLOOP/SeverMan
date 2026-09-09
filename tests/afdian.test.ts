import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { startLocalPostgres } from "../scripts/local-postgres.js";
import { migrateQueue } from "../scripts/queue-migrate.js";
import { migrate } from "../src/db/migrations.js";
import { AfdianBilling } from "../src/afdian.js";
import { AfdianClient, amountCents, signedRequest, type AfdianConfig, type JsonObject } from "../src/afdian-client.js";
import { registerAfdian } from "../src/afdian-routes.js";
import { HttpError } from "../src/errors.js";
import { readPlatformConfig } from "../src/platform-config.js";
import { hasEntitlement } from "../sdk/entitlements.js";

let local: Awaited<ReturnType<typeof startLocalPostgres>>;
let pool: Pool; let boss: PgBoss; let billing: AfdianBilling;
const app = Fastify();
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const externalUser = "b".repeat(32); const externalPlan = "c".repeat(32);
const config: AfdianConfig = { userId: "a".repeat(32), token: "test-token", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  plans: [{ id: "membership", planId: externalPlan, entitlements: ["railround.premium"], permanent: false, enabled: true }], oauth: { clientId: "test", clientSecret: "test-secret" } };
const orders = new Map<string, JsonObject>();
let expiry = Math.floor(Date.now() / 1000) + 86400 * 30;
let sponsorAvailable = true; let failedPage = 0; let oauthUser = externalUser;
const calls: { method: string; params: JsonObject }[] = [];
const transport: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/api/oauth2/access_token") return Response.json({ ec: 200, data: { user_id: oauthUser } });
  const body = JSON.parse(String(init!.body));
  const params = JSON.parse(body.params);
  assert.deepEqual(body, signedRequest(config.userId, config.token, params, body.ts));
  const method = url.pathname.split("/").at(-1)!;
  calls.push({ method, params });
  if (method === "query-plan") return Response.json({ ec: 200, data: { plan: { plan_id: externalPlan, name: "月度会员", desc: "行程统计与会员内容", price: "5.00", product_type: 0, permanent: 0, pay_month: 1, reply_content: "private-code" } } });
  if (method === "query-order") {
    if (params.out_trade_no) return Response.json({ ec: 200, data: { list: orders.has(params.out_trade_no) ? [orders.get(params.out_trade_no)] : [] } });
    if (params.page === failedPage) return Response.json({ ec: 500, data: {} });
    const list = [...orders.values()];
    // 每页两条用于验证分页完成条件，服务端仍发送官方 per_page 参数。
    return Response.json({ ec: 200, data: { list: list.slice((params.page - 1) * 2, params.page * 2), total_page: Math.ceil(list.length / 2) } });
  }
  if (method === "query-sponsor") return Response.json({ ec: 200, data: { list: sponsorAvailable ? [{ user: { user_id: params.user_id }, current_plan: { name: "" }, sponsor_plans: [{ plan_id: externalPlan, permanent: 0, expire_time: expiry }] }] : [] } });
  throw new Error("未知测试接口");
};
function order(id: string, overrides: JsonObject = {}) {
  const value = { out_trade_no: id, user_id: externalUser, plan_id: externalPlan, total_amount: "5.00", month: 1, product_type: 0, status: 2, custom_order_id: "", ...overrides };
  orders.set(id, value); return value;
}
function webhook(value: JsonObject, changed: JsonObject = {}) {
  const message = [value.out_trade_no, value.user_id, value.plan_id, value.total_amount].join("");
  return JSON.stringify({ ec: 200, data: { type: "order", order: { ...value, ...changed }, sign: sign("RSA-SHA256", Buffer.from(message), keys.privateKey).toString("base64") } });
}
async function drain() {
  for (let i = 0; i < 100; i++) {
    const pending = (await pool.query("SELECT id FROM core.billing_tasks WHERE status='pending' ORDER BY created_at,id LIMIT 1")).rows[0];
    if (!pending) return;
    await billing.process(pending.id);
  }
  throw new Error("支付任务未结束");
}
before(async () => {
  local = await startLocalPostgres(); await migrate(local.admin); await migrateQueue(local.adminUrl);
  pool = new Pool({ connectionString: local.databaseUrl, max: 3 });
  boss = new PgBoss({ connectionString: local.databaseUrl, schema: "jobs", max: 2, migrate: false });
  await boss.start();
  billing = new AfdianBilling(pool, boss, config, "test-seal-secret", "http://127.0.0.1:3000", new AfdianClient(config, transport));
  await billing.start(false);
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof HttpError ? error.statusCode : 500).send({ error: { code: error instanceof HttpError ? error.code : "INTERNAL_ERROR" } }));
  registerAfdian(app, billing, pool, async (request) => {
    if (!request.headers["x-user"]) throw new HttpError(401, "AUTH_REQUIRED");
    return { id: String(request.headers["x-user"]) };
  }, async (request) => { if (request.headers["x-user"] !== "admin") throw new HttpError(403, "ADMIN_REQUIRED"); return { id: "admin" }; });
  const plan = await billing.enqueue("plan", { planId: externalPlan }, "first-plan"); await billing.process(plan.id);
}, { timeout: 90_000 });
after(async () => { await app.close(); await boss?.stop(); await pool?.end(); await local?.close(); });

test("官方签名向量、整数金额和配置校验", () => {
  assert.equal(signedRequest("abc", "123", { a: 333 }, 1624339905).sign, "a4acc28b81598b7e5d84ebdc3e91710c");
  assert.equal(amountCents("12.01"), 1201); assert.equal(amountCents("0.00"), 0);
  assert.throws(() => amountCents("5.001")); assert.throws(() => amountCents(-1));
  const env = { AUTH_SECRET: "x".repeat(32), AUTH_DATABASE_URL: "test", QUEUE_DATABASE_URL: "test", AFDIAN_USER_ID: config.userId, AFDIAN_TOKEN: config.token, AFDIAN_PLANS_JSON: JSON.stringify(config.plans) };
  assert.equal(readPlatformConfig(env).afdian?.plans[0]?.id, "membership");
  assert.throws(() => readPlatformConfig({ ...env, AFDIAN_PLANS_JSON: JSON.stringify([...config.plans, ...config.plans]) }));
});
test("套餐公开内容同步，支付关联幂等，权益规则保留购买版本", async () => {
  const plans = await app.inject("/v1/billing/plans");
  assert.equal(plans.json().items[0].price_cents, 500);
  assert.equal(plans.json().items[0].available, true);
  assert.ok(!plans.body.includes("private-code"));
  const created = await Promise.all([billing.checkout("alice", "membership", 1, "checkout"), billing.checkout("alice", "membership", 1, "checkout")]);
  assert.equal(created[0].id, created[1].id);
  await assert.rejects(billing.checkout("alice", "membership", 3, "checkout"), { code: "IDEMPOTENCY_CONFLICT" });
  order("paid-1", { custom_order_id: created[0].id });
  config.plans[0]!.entitlements = ["railround.premium", "railround.extra"];
  await billing.start(false);
});
test("Webhook 验签、持久入队、并发重复通知与未签名字段篡改", async () => {
  const value = orders.get("paid-1")!;
  const invalid = await app.inject({ method: "POST", url: "/v1/billing/afdian/webhook", headers: { "content-type": "application/json" }, payload: webhook(value, { total_amount: "999.00" }) });
  assert.equal(invalid.statusCode, 401);
  const payload = webhook(value, { month: 1200, custom_order_id: "attacker", status: 9 });
  const responses = await Promise.all(Array.from({ length: 3 }, () => app.inject({ method: "POST", url: "/v1/billing/afdian/webhook", headers: { "content-type": "application/json" }, payload })));
  assert.ok(responses.every((r) => r.json().ec === 200));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM core.billing_events")).rows[0].n, 1);
  assert.equal((await billing.subscription("alice")).grants.length, 0);
  await drain();
  const subscription = await billing.subscription("alice");
  assert.deepEqual(subscription.entitlements.map((e) => e.entitlement_key), ["railround.premium"]);
  assert.equal(subscription.grants[0].rule_version, 1);
  assert.equal(subscription.grants[0].valid_until.getTime(), expiry * 1000);
  assert.equal((await billing.subscription("attacker")).grants.length, 0);
  await billing.webhook(Buffer.from(payload)); await drain();
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM core.billing_grants")).rows[0].n, 1);
});
test("一次性购买关联、未知套餐与跨用户订单核销", async () => {
  const stolen = await billing.enqueue("order", { orderId: "paid-1" }, "steal-order", "bob"); await billing.process(stolen.id);
  assert.equal((await billing.task(stolen.id, "bob")).error_code, "AFDIAN_ORDER_NOT_FOUND");
  const unknown = order("unknown-plan", { plan_id: "e".repeat(32) });
  await billing.webhook(Buffer.from(webhook(unknown))); await drain();
  assert.equal((await pool.query("SELECT state FROM core.billing_orders WHERE id='unknown-plan'")).rows[0].state, "unmapped");
  const reused = order("reused-checkout", { custom_order_id: orders.get("paid-1")!.custom_order_id });
  await billing.webhook(Buffer.from(webhook(reused))); await drain();
  assert.equal((await pool.query("SELECT state FROM core.billing_orders WHERE id='reused-checkout'")).rows[0].state, "review");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM core.billing_grants")).rows[0].n, 1);
  assert.equal((await app.inject("/v1/billing/orders")).statusCode, 401);
  assert.deepEqual((await app.inject({ url: "/v1/billing/orders", headers: { "x-user": "bob" } })).json().items, []);
  assert.equal((await app.inject({ url: "/v1/admin/billing", headers: { "x-user": "alice" } })).statusCode, 403);
});
test("OAuth2 关联使用登录身份和一次性 state，支持重复关联及账号冲突", async () => {
  const start = await billing.oauthStart("alice"); const state = new URL(start.url).searchParams.get("state")!;
  await assert.rejects(billing.oauthCallback("bob", state, "code"), { code: "AFDIAN_INVALID_STATE" });
  await billing.oauthCallback("alice", state, "code");
  await assert.rejects(billing.oauthCallback("alice", state, "code"), { code: "AFDIAN_INVALID_STATE" });
  const other = new URL((await billing.oauthStart("bob")).url).searchParams.get("state")!;
  await assert.rejects(billing.oauthCallback("bob", other, "code"), { code: "AFDIAN_ACCOUNT_CONFLICT" });
  assert.equal((await billing.subscription("alice")).account.provider_user_id, externalUser);
  await drain();
});
test("分页 API 恢复遗漏通知，任务等待全部核销完成，失败页面可重试", async () => {
  order("missing-webhook");
  failedPage = 2;
  const root = await billing.syncUser("alice", "sync-with-failure");
  await billing.process(root.id);
  assert.equal((await billing.task(root.id, "alice")).status, "pending");
  let failedId = "";
  for (let i = 0; i < 50; i++) {
    const pending = (await pool.query("SELECT id FROM core.billing_tasks WHERE status='pending' ORDER BY created_at,id LIMIT 1")).rows[0];
    if (!pending) break;
    try { await billing.process(pending.id); } catch { failedId = pending.id; break; }
  }
  assert.ok(failedId);
  assert.equal((await billing.task(root.id, "alice")).status, "pending");
  failedPage = 0; await billing.process(failedId); await drain();
  // review 订单进入人工检查会使本次核销任务失败，单独新订单仍正常提交。
  const missing = (await pool.query("SELECT state FROM core.billing_orders WHERE id='missing-webhook'")).rows[0];
  assert.equal(missing.state, "granted");
  assert.ok((await billing.subscription("alice")).entitlements.some((e) => e.entitlement_key === "railround.extra"));
  await assert.rejects(billing.task(root.id, "bob"), { code: "OPERATION_NOT_FOUND" });
  assert.ok(calls.some((c) => c.method === "query-order" && c.params.page === 2));
});
test("完整同步的成功状态包含分页子任务，权益读取可以共享业务事务", async () => {
  oauthUser = "f".repeat(32);
  const state = new URL((await billing.oauthStart("carol")).url).searchParams.get("state")!;
  await billing.oauthCallback("carol", state, "code");
  order("carol-order", { user_id: oauthUser });
  const root = await billing.syncUser("carol", "complete-sync"); await billing.process(root.id);
  assert.equal((await billing.task(root.id, "carol")).status, "pending");
  await drain();
  const result = await billing.task(root.id, "carol");
  assert.equal(result.status, "succeeded");
  assert.ok(result.progress.total > 2); assert.equal(result.progress.total, result.progress.completed);
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(await hasEntitlement(db, "carol", "railround.premium"), true);
    assert.equal(await hasEntitlement(db, "bob", "railround.premium"), false);
    await db.query("COMMIT");
  } finally { db.release(); }
});
test("续费创建独立权益期限，原订单规则与期限保持可追溯", async () => {
  const first = (await pool.query("SELECT valid_until FROM core.billing_grants WHERE order_id='paid-1'")).rows[0].valid_until;
  expiry += 86400 * 30;
  order("renewal");
  const next = await billing.enqueue("order", { orderId: "renewal" }, "renewal"); await billing.process(next.id);
  const older = (await pool.query("SELECT valid_until,rule_version FROM core.billing_grants WHERE order_id='paid-1'")).rows[0];
  assert.equal(older.valid_until.getTime(), first.getTime()); assert.equal(older.rule_version, 1);
  const newer = (await pool.query("SELECT valid_until,rule_version FROM core.billing_grants WHERE order_id='renewal'")).rows[0];
  assert.equal(newer.valid_until.getTime(), expiry * 1000); assert.equal(newer.rule_version, 2);
});
test("实时到期、赞助移除与订单状态变化会停止权益，旧通知通过 API 复核", async () => {
  expiry = Math.floor(Date.now() / 1000) - 1;
  const expireTask = await billing.enqueue("sponsor", { providerUserId: externalUser }, "expire"); await billing.process(expireTask.id);
  assert.equal((await billing.subscription("alice")).entitlements.length, 0);
  expiry = Math.floor(Date.now() / 1000) + 86400;
  sponsorAvailable = false;
  const removal = await billing.enqueue("sponsor", { providerUserId: externalUser }, "removed"); await billing.process(removal.id);
  assert.equal((await billing.subscription("alice")).entitlements.length, 0);
  sponsorAvailable = true;
  for (const value of orders.values()) value.status = 9;
  const refresh = await billing.enqueue("order", { orderId: "paid-1" }, "status-change"); await billing.process(refresh.id);
  assert.equal((await pool.query("SELECT active FROM core.billing_grants WHERE order_id='paid-1'")).rows[0].active, false);
  const snapshot = (await pool.query("SELECT status FROM core.billing_orders WHERE id='paid-1'")).rows[0].status;
  assert.equal(snapshot, 9);
});
test("增量对账复用已确认订单，完整对账继续复核，管理端可检查异常", async () => {
  const incremental = await billing.enqueue("scan", { page: 1, full: false, run: "incremental" }, "incremental");
  await billing.process(incremental.id);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM core.billing_tasks WHERE parent_id=$1 AND kind='order' AND payload->>'orderId'='paid-1'", [incremental.id])).rows[0].n, 0);
  const complete = await billing.enqueue("scan", { page: 1, full: true, run: "full-check" }, "full-check");
  await billing.process(complete.id);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM core.billing_tasks WHERE parent_id=$1 AND kind='order' AND payload->>'orderId'='paid-1'", [complete.id])).rows[0].n, 1);
  const dashboard = await app.inject({ url: "/v1/admin/billing", headers: { "x-user": "admin" } });
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  assert.ok(dashboard.json().tasks.some((task: { status: string }) => task.status === "failed"));
  await drain();
});
test("实际队列执行、失败记录重试与数据库读取权限", async () => {
  const value = order("queue-payment");
  await billing.start(true);
  const task = await billing.enqueue("order", { orderId: value.out_trade_no }, `queue:${randomUUID()}`, "alice");
  let status = "pending";
  for (let i = 0; i < 150; i++) { status = (await billing.task(task.id, "alice")).status; if (status === "succeeded") break; await delay(100); }
  assert.equal(status, "succeeded");
  const reader = new Pool({ connectionString: local.readDatabaseUrl, max: 1 });
  try { await assert.rejects(reader.query("SELECT * FROM core.billing_events"), { code: "42501" }); }
  finally { await reader.end(); }
  assert.ok((await billing.subscription("alice")).entitlements.length > 0);
});
