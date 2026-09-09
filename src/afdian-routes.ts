import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AfdianBilling } from "./afdian.js";
import { HttpError } from "./errors.js";

type CurrentUser = (request: FastifyRequest) => Promise<{ id: string }>;
function key(request: FastifyRequest) {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || !/^[\w-]{1,128}$/.test(value)) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED");
  return value;
}
export function registerAfdian(app: FastifyInstance, billing: AfdianBilling, pool: Pool, user: CurrentUser, admin: CurrentUser) {
  const limited = { rateLimit: { max: 5, timeWindow: "1 minute" } };
  app.get("/v1/billing/plans", async () => ({ items: await billing.plans() }));
  app.post<{ Body: { plan_id: string; months: number } }>("/v1/billing/afdian/checkout", {
    config: limited, schema: { body: { type: "object", additionalProperties: false, required: ["plan_id", "months"], properties: {
      plan_id: { type: "string", maxLength: 50 }, months: { type: "integer", minimum: 1, maximum: 36 },
    } } },
  }, async (request) => billing.checkout((await user(request)).id, request.body.plan_id, request.body.months, key(request)));
  app.post("/v1/billing/afdian/link", { config: limited }, async (request) => billing.oauthStart((await user(request)).id));
  app.get<{ Querystring: { state: string; code: string } }>("/v1/billing/afdian/callback", {
    schema: { querystring: { type: "object", required: ["state", "code"], properties: { state: { type: "string", maxLength: 128 }, code: { type: "string", maxLength: 512 } } } },
  }, async (request, reply) => {
    await billing.oauthCallback((await user(request)).id, request.query.state, request.query.code);
    return reply.header("referrer-policy", "no-referrer").redirect(`${billing.origin}/?billing=linked`);
  });
  app.post("/v1/billing/afdian/sync", { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } }, async (request, reply) => {
    const task = await billing.syncUser((await user(request)).id, key(request));
    return reply.code(202).header("location", `/v1/billing/tasks/${task.id}`).send(task);
  });
  app.post<{ Body: { order_id: string } }>("/v1/billing/afdian/redeem", { config: limited,
    schema: { body: { type: "object", required: ["order_id"], additionalProperties: false, properties: { order_id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,128}$" } } } },
  }, async (request, reply) => {
    const current = await user(request);
    const task = await billing.enqueue("order", { orderId: request.body.order_id, source: "user" }, `user:${current.id}:${key(request)}`, current.id);
    return reply.code(202).header("location", `/v1/billing/tasks/${task.id}`).send(task);
  });
  app.get<{ Params: { id: string } }>("/v1/billing/tasks/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request) => billing.task(request.params.id, (await user(request)).id));
  app.get<{ Querystring: { limit?: number; offset?: number } }>("/v1/billing/orders", {
    schema: { querystring: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0, maximum: 10000 } } } },
  }, async (request) => ({ items: await billing.history((await user(request)).id, request.query.limit ?? 20, request.query.offset ?? 0) }));
  app.get("/v1/admin/billing", async (request) => {
    await admin(request);
    return { tasks: (await pool.query("SELECT id,kind,status,attempts,error_code,created_at,updated_at FROM core.billing_tasks ORDER BY (status IN ('failed','retrying')) DESC,updated_at DESC LIMIT 100")).rows,
      orders: (await pool.query("SELECT state,count(*)::int AS count FROM core.billing_orders GROUP BY state")).rows,
      plans: await billing.plans() };
  });
  app.post("/v1/admin/billing/sync", { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } }, async (request, reply) => {
    const current = await admin(request);
    const task = await billing.enqueue("reconcile", { full: true }, `admin:${current.id}:${key(request)}`, current.id);
    return reply.code(202).header("location", `/v1/billing/tasks/${task.id}`).send(task);
  });
  app.get<{ Params: { id: string } }>("/v1/admin/billing/tasks/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request) => {
    await admin(request);
    const owner = (await pool.query("SELECT actor_id FROM core.billing_tasks WHERE id=$1", [request.params.id])).rows[0];
    if (!owner) throw new HttpError(404, "OPERATION_NOT_FOUND");
    return billing.task(request.params.id, owner.actor_id);
  });
  app.post<{ Params: { id: string } }>("/v1/admin/billing/tasks/:id/retry", {
    config: limited, schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const current = await admin(request);
    const old = (await pool.query("SELECT kind,payload,actor_id FROM core.billing_tasks WHERE id=$1 AND status='failed'", [request.params.id])).rows[0];
    if (!old) throw new HttpError(404, "OPERATION_NOT_FOUND");
    await pool.query("INSERT INTO core.audit_events(actor_id,action,resource_id) VALUES($1,'billing.retry',$2)", [current.id, request.params.id]);
    // 保留原请求人的归属限制，运维重试仅负责再次执行原操作。
    const retryKey = `retry:${request.params.id}:${key(request)}`;
    const task = await billing.enqueue(old.kind, old.kind === "scan" ? { ...old.payload, run: retryKey } : old.payload, retryKey, old.actor_id);
    return reply.code(202).send(task);
  });
  app.register(async (hooks) => {
    hooks.removeContentTypeParser("application/json");
    hooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    hooks.post("/v1/billing/afdian/webhook", async (request) => billing.webhook(request.body as Buffer));
  });
}
