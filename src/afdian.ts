import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { AfdianClient, amountCents, identifier, object, verifyAfdianWebhook, type AfdianConfig, type JsonObject } from "./afdian-client.js";
import { HttpError } from "./errors.js";
import { seal } from "./security.js";

const QUEUE = "billing-afdian";
type TaskKind = "order" | "sponsor" | "plan" | "scan" | "reconcile";
interface Task { id: string; actor_id: string | null; kind: TaskKind; payload: JsonObject; status: string; attempts: number }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const signedFields = (order: JsonObject) => [order.out_trade_no, order.user_id, order.plan_id, order.total_amount];

export class AfdianBilling {
  constructor(private pool: Pool, private boss: PgBoss, readonly config: AfdianConfig,
    private secret: string, readonly origin: string, readonly client = new AfdianClient(config)) {}

  private async transaction<T>(fn: (db: PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try { await db.query("BEGIN"); const result = await fn(db); await db.query("COMMIT"); return result; }
    catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  }
  async start(worker: boolean) {
    await this.transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(736004)");
      await db.query("UPDATE core.billing_plans SET enabled=false WHERE NOT(id=ANY($1::text[]))", [this.config.plans.map((p) => p.id)]);
      for (const plan of this.config.plans) {
        const existing = (await db.query("SELECT provider_plan_id FROM core.billing_plans WHERE id=$1", [plan.id])).rows[0];
        if (existing && existing.provider_plan_id !== plan.planId) throw new Error("套餐外部 ID 变更时须使用新的本地套餐 ID");
        await db.query(`INSERT INTO core.billing_plans(id,provider_plan_id,entitlements,permanent,enabled) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(id) DO UPDATE SET entitlements=excluded.entitlements,permanent=excluded.permanent,enabled=excluded.enabled,
          rule_version=core.billing_plans.rule_version+CASE WHEN (core.billing_plans.entitlements,core.billing_plans.permanent) IS DISTINCT FROM (excluded.entitlements,excluded.permanent) THEN 1 ELSE 0 END,
          remote_valid=core.billing_plans.remote_valid AND core.billing_plans.permanent=excluded.permanent,updated_at=now()`,
        [plan.id, plan.planId, [...new Set(plan.entitlements)].sort(), plan.permanent, plan.enabled]);
      }
    });
    await this.boss.createQueue(QUEUE, { policy: "singleton", retryLimit: 5, retryDelay: 10, retryBackoff: true, expireInSeconds: 90 });
    await this.boss.createQueue(`${QUEUE}-timer`, { policy: "singleton", retryLimit: 3 });
    if (worker) {
      await this.boss.work<{ id: string }>(QUEUE, { localConcurrency: 1, pollingIntervalSeconds: 0.5 }, async ([job]) => {
        if (job) await this.process(job.data.id);
      });
      await this.boss.work<{ full?: boolean }>(`${QUEUE}-timer`, async ([job]) => {
        if (job) await this.enqueue("reconcile", { full: Boolean(job.data.full) }, `timer:${job.id}`);
      });
      await this.boss.schedule(`${QUEUE}-timer`, "*/15 * * * *", { full: false }, { key: "recent" });
      await this.boss.schedule(`${QUEUE}-timer`, "17 3 * * *", { full: true }, { key: "full", tz: "Asia/Shanghai" });
      await this.enqueue("reconcile", { full: false }, `startup:${Math.floor(Date.now() / 900_000)}`);
    }
  }
  private async insertTask(db: PoolClient, kind: TaskKind, payload: JsonObject, key: string, actor: string | null = null, parent: string | null = null) {
    const id = randomUUID();
    const inserted = await db.query(`INSERT INTO core.billing_tasks(id,actor_id,kind,request_key,payload,parent_id) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(request_key) DO NOTHING RETURNING id,status`, [id, actor, kind, key, payload, parent]);
    if (!inserted.rowCount) {
      const existing = (await db.query("SELECT id,status,kind,payload,actor_id FROM core.billing_tasks WHERE request_key=$1", [key])).rows[0];
      const equal = await db.query("SELECT 1 FROM core.billing_tasks WHERE request_key=$1 AND kind=$2 AND actor_id IS NOT DISTINCT FROM $3 AND payload=$4::jsonb", [key, kind, actor, JSON.stringify(payload)]);
      if (!equal.rowCount) throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
      return { id: existing.id as string, status: existing.status as string };
    }
    await this.boss.send(QUEUE, { id }, { priority: payload.source === "webhook" ? 10 : actor ? 5 : 0, db: { executeSql: (sql, values) => db.query(sql, values) } });
    return { id, status: "pending" };
  }
  enqueue(kind: TaskKind, payload: JsonObject, key: string, actor: string | null = null) {
    return this.transaction((db) => this.insertTask(db, kind, payload, key, actor));
  }
  async webhook(raw: Buffer) {
    let payload: unknown;
    try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "INVALID_REQUEST"); }
    const order = verifyAfdianWebhook(payload, this.config.publicKey);
    const eventId = digest(JSON.stringify(signedFields(order)));
    await this.transaction(async (db) => {
      const task = await this.insertTask(db, "order", { orderId: order.out_trade_no, signed: signedFields(order), source: "webhook" }, `webhook:${eventId}`);
      await db.query("INSERT INTO core.billing_events(id,order_id,task_id,payload_encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [eventId, order.out_trade_no, task.id, seal({ raw: raw.toString("utf8") }, this.secret)]);
    });
    return { ec: 200, em: "" };
  }
  async plans() {
    return (await this.pool.query(`SELECT id,provider_plan_id,name,description,price_cents::float8,permanent,pay_month,entitlements,rule_version,synced_at,
      (remote_valid AND synced_at>now()-interval '24 hours') AS available FROM core.billing_plans WHERE enabled ORDER BY id`)).rows;
  }
  async checkout(userId: string, planId: string, months: number, key: string) {
    return this.transaction(async (db) => {
      const existing = (await db.query("SELECT * FROM core.billing_checkouts WHERE user_id=$1 AND idempotency_key=$2", [userId, key])).rows[0];
      if (existing && (existing.plan_id !== planId || existing.months !== months)) throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
      const plan = (await db.query("SELECT * FROM core.billing_plans WHERE id=$1", [planId])).rows[0];
      if (!plan || !plan.enabled || !plan.remote_valid || Date.now() - new Date(plan.synced_at).getTime() > 86400_000) throw new HttpError(409, "AFDIAN_PLAN_UNAVAILABLE");
      if (months % plan.pay_month !== 0 || (plan.permanent && months !== 1)) throw new HttpError(400, "AFDIAN_INVALID_MONTHS");
      const id = `sm_${randomBytes(24).toString("base64url")}`;
      const inserted = await db.query(`INSERT INTO core.billing_checkouts(id,user_id,idempotency_key,plan_id,rule_version,entitlements,permanent,months)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`,
      [id, userId, key, planId, plan.rule_version, plan.entitlements, plan.permanent, months]);
      const row = inserted.rows[0];
      if (row.plan_id !== planId || row.months !== months) throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
      if (row.order_id || new Date(row.expires_at).getTime() <= Date.now()) throw new HttpError(409, "AFDIAN_CHECKOUT_EXPIRED");
      const url = new URL("https://ifdian.net/order/create");
      url.search = new URLSearchParams({ plan_id: plan.provider_plan_id, product_type: "0", month: String(months), custom_order_id: row.id }).toString();
      return { id: row.id, url: url.href, expires_at: row.expires_at };
    });
  }
  async oauthStart(userId: string) {
    if (!this.config.oauth) throw new HttpError(503, "AFDIAN_OAUTH_UNAVAILABLE");
    const state = randomBytes(32).toString("base64url");
    await this.pool.query("DELETE FROM core.billing_oauth_states WHERE expires_at<now()");
    await this.pool.query("INSERT INTO core.billing_oauth_states VALUES($1,$2,now()+interval '10 minutes')", [digest(state), userId]);
    const url = new URL("https://ifdian.net/oauth2/authorize");
    url.search = new URLSearchParams({ response_type: "code", scope: "basic", client_id: this.config.oauth.clientId, redirect_uri: `${this.origin}/v1/billing/afdian/callback`, state }).toString();
    return { url: url.href };
  }
  async oauthCallback(userId: string, state: string, code: string) {
    const consumed = await this.pool.query("DELETE FROM core.billing_oauth_states WHERE digest=$1 AND user_id=$2 AND expires_at>now() RETURNING user_id", [digest(state), userId]);
    if (!consumed.rowCount) throw new HttpError(400, "AFDIAN_INVALID_STATE");
    const providerUserId = await this.client.oauth(code, `${this.origin}/v1/billing/afdian/callback`);
    await this.transaction(async (db) => {
      await db.query("INSERT INTO core.billing_accounts(user_id,provider_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, providerUserId]);
      const linked = await db.query("SELECT 1 FROM core.billing_accounts WHERE user_id=$1 AND provider_user_id=$2", [userId, providerUserId]);
      if (!linked.rowCount) throw new HttpError(409, "AFDIAN_ACCOUNT_CONFLICT");
      await this.insertTask(db, "sponsor", { providerUserId }, `link:${userId}:${randomUUID()}`, userId);
    });
  }
  async syncUser(userId: string, key: string) {
    const account = (await this.pool.query("SELECT provider_user_id FROM core.billing_accounts WHERE user_id=$1", [userId])).rows[0];
    if (!account) throw new HttpError(409, "AFDIAN_ACCOUNT_REQUIRED");
    return this.enqueue("sponsor", { providerUserId: account.provider_user_id }, `user:${userId}:${key}`, userId);
  }
  async task(id: string, userId: string | null) {
    const result = (await this.pool.query("SELECT id,kind,status,result,error_code,attempts FROM core.billing_tasks WHERE id=$1 AND actor_id IS NOT DISTINCT FROM $2", [id, userId])).rows[0];
    if (!result) throw new HttpError(404, "OPERATION_NOT_FOUND");
    const progress = (await this.pool.query(`WITH RECURSIVE tree AS (
      SELECT id,status,error_code FROM core.billing_tasks WHERE id=$1 UNION ALL
      SELECT t.id,t.status,t.error_code FROM core.billing_tasks t JOIN tree p ON t.parent_id=p.id)
      SELECT count(*)::int AS total,count(*) FILTER(WHERE status='succeeded')::int AS completed,
      bool_or(status='failed') AS failed,max(error_code) FILTER(WHERE status='failed') AS error_code FROM tree`, [id])).rows[0];
    return { ...result, status: progress.failed ? "failed" : progress.completed === progress.total ? "succeeded" : "pending", error_code: progress.error_code ?? result.error_code, progress: { total: progress.total, completed: progress.completed } };
  }
  async subscription(userId: string) {
    return this.transaction(async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const account = (await db.query("SELECT provider_user_id,linked_at,synced_at FROM core.billing_accounts WHERE user_id=$1", [userId])).rows[0] ?? null;
      const entitlements = (await db.query("SELECT entitlement_key,valid_until FROM core.billing_entitlements_v1 WHERE user_id=$1 ORDER BY entitlement_key", [userId])).rows;
      const grants = (await db.query(`SELECT g.order_id,g.plan_id,p.name,g.permanent,g.valid_until,g.rule_version,
        (g.active AND (g.permanent OR g.valid_until>now())) AS active FROM core.billing_grants g JOIN core.billing_plans p ON p.id=g.plan_id WHERE g.user_id=$1 ORDER BY g.granted_at DESC LIMIT 100`, [userId])).rows;
      return { provider: "afdian", account, entitlements, grants, observed_at: new Date().toISOString() };
    });
  }
  async history(userId: string, limit: number, offset: number) {
    return (await this.pool.query(`SELECT o.id,o.amount_cents::float8,o.months,o.state,o.first_seen_at,o.verified_at,g.plan_id,p.name,g.valid_until
      FROM core.billing_orders o LEFT JOIN core.billing_grants g ON g.order_id=o.id LEFT JOIN core.billing_plans p ON p.id=g.plan_id
      WHERE o.user_id=$1 ORDER BY o.first_seen_at DESC,o.id DESC LIMIT $2 OFFSET $3`, [userId, limit, offset])).rows;
  }
  private periods(sponsor: JsonObject | null) {
    const periods = new Map<string, { permanent: boolean; until: Date }>();
    if (!sponsor) return periods;
    if (!Array.isArray(sponsor.sponsor_plans)) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
    const current = sponsor.current_plan ? object(sponsor.current_plan) : {};
    for (const plan of [...sponsor.sponsor_plans.map(object), ...(current.plan_id ? [current] : [])]) {
      const id = identifier(plan.plan_id);
      const seconds = Number(plan.expire_time);
      if (![0, 1].includes(Number(plan.permanent)) || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 253402300799) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
      const value = { permanent: Number(plan.permanent) === 1, until: new Date(seconds * 1000) };
      const previous = periods.get(id);
      if (!previous || value.permanent || value.until > previous.until) periods.set(id, value);
    }
    return periods;
  }
  private async applySponsor(db: PoolClient, providerUserId: string, sponsor: JsonObject | null) {
    const periods = this.periods(sponsor);
    const grants = (await db.query(`SELECT g.order_id,g.permanent,g.period_confirmed,g.valid_until,o.provider_plan_id,o.status FROM core.billing_grants g
      JOIN core.billing_orders o ON o.id=g.order_id WHERE o.provider_user_id=$1`, [providerUserId])).rows;
    for (const grant of grants) {
      const period = periods.get(grant.provider_plan_id);
      const active = grant.status === 2 && Boolean(period) && grant.permanent === period!.permanent;
      // 每笔订单固定首次确认的权益期限，后续续费通过新订单授予新版本权益。
      const until = grant.permanent ? null : period ? new Date(Math.min(period.until.getTime(), grant.period_confirmed ? grant.valid_until.getTime() : Infinity)) : grant.valid_until;
      await db.query("UPDATE core.billing_grants SET active=$2,valid_until=$3,period_confirmed=period_confirmed OR $4,updated_at=now() WHERE order_id=$1", [grant.order_id, active, until, Boolean(period)]);
    }
    await db.query("UPDATE core.billing_accounts SET synced_at=now() WHERE provider_user_id=$1", [providerUserId]);
  }
  private async processOrder(task: Task) {
    const order = await this.client.order(identifier(task.payload.orderId));
    const id = identifier(order.out_trade_no); const providerUserId = identifier(order.user_id);
    const planId = typeof order.plan_id === "string" ? order.plan_id : "";
    const cents = amountCents(order.total_amount);
    const status = Number(order.status); const months = Number(order.month); const productType = Number(order.product_type);
    if (![status, months, productType].every(Number.isSafeInteger) || months < 0 || months > 1200) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
    if (task.payload.signed && JSON.stringify(task.payload.signed) !== JSON.stringify(signedFields(order))) throw new HttpError(409, "AFDIAN_ORDER_CONFLICT");
    const sponsor = await this.client.sponsor(providerUserId);
    const periods = this.periods(sponsor);
    return this.transaction(async (db) => {
      const plan = (await db.query("SELECT * FROM core.billing_plans WHERE provider_plan_id=$1", [planId])).rows[0];
      const checkout = typeof order.custom_order_id === "string" ? (await db.query("SELECT * FROM core.billing_checkouts WHERE id=$1 FOR UPDATE", [order.custom_order_id])).rows[0] : undefined;
      const linked = (await db.query("SELECT user_id FROM core.billing_accounts WHERE provider_user_id=$1", [providerUserId])).rows[0];
      const existing = (await db.query("SELECT * FROM core.billing_orders WHERE id=$1 FOR UPDATE", [id])).rows[0];
      const grant = (await db.query("SELECT * FROM core.billing_grants WHERE order_id=$1", [id])).rows[0];
      const userId = existing?.user_id ?? checkout?.user_id ?? linked?.user_id ?? null;
      if (task.actor_id && userId !== task.actor_id) throw new HttpError(404, "AFDIAN_ORDER_NOT_FOUND");
      const conflict = (existing && (existing.provider_user_id !== providerUserId || existing.provider_plan_id !== planId || existing.amount_cents !== String(cents) || existing.months !== months || existing.product_type !== productType))
        || (checkout && (checkout.plan_id !== plan?.id || checkout.months !== months || (checkout.order_id && checkout.order_id !== id)))
        || (linked && userId && linked.user_id !== userId);
      if (conflict && existing) throw new HttpError(409, "AFDIAN_ORDER_CONFLICT");
      const state = conflict ? "review" : !plan ? "unmapped" : !userId ? "unclaimed" : status !== 2 ? "inactive"
        : productType !== 0 || (!grant && !checkout && !plan.enabled) ? "review" : "granted";
      await db.query(`INSERT INTO core.billing_orders(id,provider_user_id,provider_plan_id,user_id,amount_cents,status,months,product_type,custom_order_id,state,source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,status=excluded.status,state=excluded.state,verified_at=now(),source=excluded.source`,
      [id, providerUserId, planId, conflict ? null : userId, cents, status, months, productType, typeof order.custom_order_id === "string" ? order.custom_order_id : null, state, String(task.payload.source ?? "api")]);
      if (state === "granted") {
        const rule = grant ?? checkout ?? plan;
        const period = periods.get(planId);
        await db.query(`INSERT INTO core.billing_grants(order_id,user_id,plan_id,rule_version,entitlements,permanent,active,valid_until,period_confirmed)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(order_id) DO NOTHING`,
        [id, userId, plan.id, rule.rule_version, rule.entitlements, rule.permanent, Boolean(period) && period!.permanent === rule.permanent, rule.permanent ? null : period?.until ?? new Date(0), Boolean(period)]);
        if (checkout) await db.query("UPDATE core.billing_checkouts SET order_id=$2 WHERE id=$1", [checkout.id, id]);
      }
      await this.applySponsor(db, providerUserId, sponsor);
      return { order_id: id, state };
    });
  }
  private async execute(task: Task): Promise<unknown> {
    if (task.kind === "order") return this.processOrder(task);
    if (task.kind === "plan") {
      const id = identifier(task.payload.planId);
      const remote = object((await this.client.call("query-plan", { plan_id: id })).plan);
      if (remote.plan_id !== id || typeof remote.name !== "string" || typeof remote.desc !== "string") throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
      const cents = amountCents(remote.price);
      const months = Number(remote.pay_month);
      const valid = Number(remote.product_type) === 0 && [1, 3, 12].includes(months) && [0, 1].includes(Number(remote.permanent));
      await this.pool.query(`UPDATE core.billing_plans SET name=$2,description=$3,price_cents=$4,pay_month=$5,
        remote_valid=$6 AND permanent=$7,synced_at=now(),updated_at=now() WHERE provider_plan_id=$1`,
      [id, remote.name.slice(0, 200), remote.desc.slice(0, 8000), cents, valid ? months : null, valid, Number(remote.permanent) === 1]);
      return { plan_id: id, synced: true };
    }
    if (task.kind === "sponsor") {
      const id = identifier(task.payload.providerUserId);
      const sponsor = await this.client.sponsor(id);
      await this.transaction(async (db) => {
        await this.applySponsor(db, id, sponsor);
        if (task.actor_id) await this.insertTask(db, "scan", { page: 1, full: true, run: task.id, providerUserId: id }, `${task.id}:scan`, task.actor_id, task.id);
      });
      return { synced: true };
    }
    if (task.kind === "scan") {
      const page = Number(task.payload.page);
      const data = await this.client.call("query-order", { page, per_page: 50 });
      if (!Array.isArray(data.list) || data.list.length > 50 || !Number.isInteger(data.total_page) || Number(data.total_page) < 0) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
      if (page >= 10000 && page < Number(data.total_page)) throw new HttpError(409, "AFDIAN_SCAN_LIMIT");
      await this.transaction(async (db) => {
        const entries = data.list as unknown[];
        const known = new Map((await db.query("SELECT * FROM core.billing_orders WHERE id=ANY($1::text[])", [entries.map((entry) => identifier(object(entry).out_trade_no))])).rows.map((row) => [row.id, row]));
        for (const entry of entries) {
          const order = object(entry);
          if (task.payload.providerUserId && order.user_id !== task.payload.providerUserId) continue;
          const id = identifier(order.out_trade_no);
          const previous = known.get(id);
          if (!task.payload.full && previous && ["granted", "inactive"].includes(previous.state)
            && previous.status === Number(order.status) && previous.provider_user_id === order.user_id
            && previous.provider_plan_id === order.plan_id && previous.amount_cents === String(amountCents(order.total_amount))
            && previous.months === Number(order.month) && previous.product_type === Number(order.product_type)) continue;
          await this.insertTask(db, "order", { orderId: id, source: "api" }, `scan:${task.payload.run}:${id}`, task.actor_id, task.id);
        }
        if (page < Number(data.total_page) && (task.payload.full || page < 2)) await this.insertTask(db, "scan", { ...task.payload, page: page + 1 }, `scan:${task.payload.run}:page:${page + 1}`, task.actor_id, task.id);
      });
      return { page, discovered: data.list.length, total_pages: data.total_page };
    }
    await this.transaction(async (db) => {
      const plans = (await db.query("SELECT provider_plan_id FROM core.billing_plans WHERE enabled")).rows;
      for (const plan of plans) await this.insertTask(db, "plan", { planId: plan.provider_plan_id }, `${task.id}:plan:${plan.provider_plan_id}`, null, task.id);
      const accounts = (await db.query("SELECT provider_user_id FROM core.billing_accounts UNION SELECT provider_user_id FROM core.billing_orders WHERE user_id IS NOT NULL")).rows;
      for (const account of accounts) await this.insertTask(db, "sponsor", { providerUserId: account.provider_user_id }, `${task.id}:sponsor:${account.provider_user_id}`, null, task.id);
      await this.insertTask(db, "scan", { page: 1, full: Boolean(task.payload.full), run: task.id }, `${task.id}:scan`, null, task.id);
      // 队列租约耗尽或进程中止后，持久任务记录仍可恢复。
      const stale = (await db.query("SELECT id,attempts FROM core.billing_tasks WHERE status IN ('pending','running','retrying') AND updated_at<now()-interval '20 minutes' FOR UPDATE SKIP LOCKED")).rows;
      for (const item of stale) {
        if (item.attempts >= 6) await db.query("UPDATE core.billing_tasks SET status='failed',error_code='RETRY_EXHAUSTED',updated_at=now() WHERE id=$1", [item.id]);
        else {
          await db.query("UPDATE core.billing_tasks SET status='pending',updated_at=now() WHERE id=$1", [item.id]);
          await this.boss.send(QUEUE, { id: item.id }, { db: { executeSql: (sql, values) => db.query(sql, values) } });
        }
      }
    });
    return { scheduled: true };
  }
  async process(id: string) {
    const lock = await this.pool.connect();
    let acquired = false;
    try {
      acquired = (await lock.query("SELECT pg_try_advisory_lock(736005) AS acquired")).rows[0].acquired;
      if (!acquired) throw new HttpError(503, "AFDIAN_PROCESSOR_BUSY");
      await this.processLocked(id);
    } finally {
      let discard = false;
      try { if (acquired) await lock.query("SELECT pg_advisory_unlock(736005)"); }
      catch { discard = true; }
      finally { lock.release(discard); }
    }
  }
  private async processLocked(id: string) {
    const task = (await this.pool.query<Task>(`UPDATE core.billing_tasks SET status='running',attempts=attempts+1,updated_at=now()
      WHERE id=$1 AND status NOT IN ('succeeded','failed') RETURNING *`, [id])).rows[0];
    if (!task) return;
    try {
      const result = await this.execute(task);
      await this.pool.query("UPDATE core.billing_tasks SET status='succeeded',result=$2,error_code=NULL,updated_at=now() WHERE id=$1", [id, JSON.stringify(result)]);
    } catch (error) {
      const terminal = task.attempts >= 6 || (error instanceof HttpError && error.statusCode < 500);
      await this.pool.query("UPDATE core.billing_tasks SET status=$2,error_code=$3,updated_at=now() WHERE id=$1", [id, terminal ? "failed" : "retrying", error instanceof HttpError ? error.code : "BILLING_PROCESSING_FAILED"]);
      if (!terminal) throw error;
    }
  }
}
