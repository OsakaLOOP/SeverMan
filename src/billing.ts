import Stripe from "stripe";
import type { Pool } from "pg";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlatformConfig } from "./platform-config.js";
import { HttpError } from "./errors.js";

export function registerBilling(app: FastifyInstance, config: PlatformConfig, pool: Pool, user: (request: FastifyRequest) => Promise<{ id: string; email: string }>) {
  const stripe = config.stripe ? new Stripe(config.stripe.secret, { timeout: 5000, maxNetworkRetries: 1 }) : undefined;
  app.get("/v1/billing/subscription", async (request) => ({ subscription: (await pool.query("SELECT status,price_id,updated_at FROM core.subscriptions WHERE user_id=$1", [(await user(request)).id])).rows[0] ?? null }));
  app.post<{ Body: { price_id: string } }>("/v1/billing/checkout", { schema: { body: { type: "object", additionalProperties: false, required: ["price_id"], properties: { price_id: { type: "string", maxLength: 200 } } } } }, async (request) => {
    const current = await user(request);
    if (!stripe || !config.stripe) throw new HttpError(503, "BILLING_UNAVAILABLE");
    if (!config.stripe.prices.includes(request.body.price_id)) throw new HttpError(400, "PRICE_NOT_ALLOWED");
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length > 128 || !key) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED");
    const session = await stripe.checkout.sessions.create({ mode: "subscription", customer_email: current.email, client_reference_id: current.id, line_items: [{ price: request.body.price_id, quantity: 1 }], subscription_data: { metadata: { user_id: current.id } }, success_url: `${config.origin}/?payment=success`, cancel_url: `${config.origin}/?payment=cancelled` }, { idempotencyKey: `${current.id}:${key}` });
    return { url: session.url };
  });
  app.register(async (webhooks) => {
    webhooks.removeContentTypeParser("application/json");
    webhooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    webhooks.post("/v1/billing/webhook", async (request, reply) => {
      if (!stripe || !config.stripe) throw new HttpError(503, "BILLING_UNAVAILABLE");
      let event: Stripe.Event;
      try { event = stripe.webhooks.constructEvent(request.body as Buffer, String(request.headers["stripe-signature"] ?? ""), config.stripe.webhookSecret); }
      catch { throw new HttpError(400, "INVALID_SIGNATURE"); }
      if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return { received: true };
      const incoming = event.data.object as Stripe.Subscription;
      // 主动查询当前订阅，串行化同一订阅的事件，处理重复和乱序通知。
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [incoming.id]);
        if ((await client.query("SELECT 1 FROM core.payment_events WHERE id=$1", [event.id])).rowCount) { await client.query("COMMIT"); return { received: true }; }
        const subscription = event.type === "customer.subscription.deleted" ? incoming : await stripe.subscriptions.retrieve(incoming.id);
        const userId = subscription.metadata.user_id;
        if (!userId) throw new HttpError(400, "MISSING_CUSTOMER_MAPPING");
        await client.query(`INSERT INTO core.subscriptions(user_id,provider_id,status,price_id,event_created) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(user_id) DO UPDATE SET provider_id=excluded.provider_id,status=excluded.status,price_id=excluded.price_id,event_created=excluded.event_created,updated_at=now()
          WHERE core.subscriptions.event_created<=excluded.event_created`, [userId, subscription.id, subscription.status, subscription.items.data[0]?.price.id ?? null, event.created]);
        await client.query("INSERT INTO core.payment_events(id,type) VALUES($1,$2)", [event.id, event.type]);
        await client.query("COMMIT");
        return { received: true };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
  });
}
