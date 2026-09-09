import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Link, RefreshCw } from "lucide-react";

type Client = <T>(path: string, method?: string, body?: unknown, key?: string) => Promise<T>;
type Plan = { id: string; name: string | null; description: string | null; price_cents: number | null; pay_month: number | null; permanent: boolean; available: boolean };
type Subscription = { account: { provider_user_id: string; synced_at: string | null } | null;
  entitlements: { entitlement_key: string; valid_until: string | null }[];
  grants: { order_id: string; name: string; active: boolean; valid_until: string | null; permanent: boolean }[] };
type Order = { id: string; amount_cents: number; name: string | null; months: number; state: string; first_seen_at: string; valid_until: string | null };
type Task = { id: string; status: string; kind?: string; error_code?: string | null; progress?: { total: number; completed: number } };
type AdminStatus = { orders: { state: string; count: number }[]; tasks: Task[] };
const stateNames: Record<string, string> = { granted: "已核销", inactive: "已失效", unclaimed: "待关联", unmapped: "待配置套餐", review: "待检查", pending: "等待处理", running: "处理中", retrying: "等待重试", failed: "失败", succeeded: "已完成" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "长期有效";
const money = (value: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(value / 100);

export function BillingPanel({ request, oauth, admin, userId }: { request: Client; oauth: boolean; admin: boolean; userId: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [months, setMonths] = useState<Record<string, number>>({});
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const storageKey = `sm-billing-task:${userId}`;
  const [pending, setPending] = useState<{ id: string; admin: boolean } | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); } catch { return null; }
  });
  const [task, setTask] = useState<Task | null>(null);
  const load = useCallback(async () => {
    const [catalog, current, history, dashboard] = await Promise.all([
      request<{ items: Plan[] }>("/v1/billing/plans"), request<{ subscription: Subscription }>("/v1/billing/subscription"),
      request<{ items: Order[] }>(`/v1/billing/orders?limit=21&offset=${page * 20}`),
      admin ? request<AdminStatus>("/v1/admin/billing") : Promise.resolve(null),
    ]);
    setPlans(catalog.items); setSubscription(current.subscription); setOrders(history.items); setStatus(dashboard); setLoading(false);
  }, [request, page, admin]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => { try { if (!stopped) await load(); } catch (e) { if (!stopped) { setError((e as Error).message); setLoading(false); } } };
    void refresh(); const timer = setInterval(() => void refresh(), 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    try { if (pending) sessionStorage.setItem(storageKey, JSON.stringify(pending)); else sessionStorage.removeItem(storageKey); } catch { /* 浏览器禁用存储时仍可在当前页面等待。 */ }
    if (!pending) return;
    let stopped = false; let checking = false;
    const checkTask = async () => {
      if (checking || stopped) return; checking = true;
      try {
        const next = await request<Task>(`${pending.admin ? "/v1/admin/billing" : "/v1/billing"}/tasks/${pending.id}`);
        if (stopped) return;
        setTask(next);
        if (next.status === "succeeded" || next.status === "failed") {
          setPending(null);
          if (next.status === "failed") setError(`同步失败：${next.error_code ?? "请稍后重试"}`);
          else setNotice("同步已完成");
          await load();
        }
      } catch (e) { if (!stopped) setError((e as Error).message); }
      finally { checking = false; }
    };
    void checkTask(); const timer = setInterval(() => void checkTask(), 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [pending, load, request, storageKey]);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function startTask(path: string, body?: unknown, isAdmin = false) {
    const next = await request<Task>(path, "POST", body, crypto.randomUUID());
    setTask(next); setPending({ id: next.id, admin: isAdmin });
  }
  const disabled = busy || Boolean(pending);
  return <section className="billing-panel" aria-busy={loading}>
    <div className="section-bar"><h2>爱发电订阅</h2><button title="刷新订阅" aria-label="刷新订阅" disabled={busy} onClick={() => void act(load)}><RefreshCw size={17} /></button></div>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {pending && <div className="notice" role="status">同步中{task?.progress ? ` · ${task.progress.completed}/${task.progress.total}` : ""}</div>}
    <div className="billing-account">
      <div><strong>{subscription?.entitlements.length ? "订阅生效中" : "暂无有效订阅"}</strong>
        <p className="muted">{subscription?.account ? `已关联爱发电 · ${subscription.account.provider_user_id}` : "爱发电账号未关联"}</p></div>
      <div className="toolbar">
        {oauth && !subscription?.account && <button disabled={disabled} onClick={() => void act(async () => { location.href = (await request<{ url: string }>("/v1/billing/afdian/link", "POST")).url; })}><Link size={16} />关联账号</button>}
        {subscription?.account && <button disabled={disabled} onClick={() => void act(() => startTask("/v1/billing/afdian/sync"))}><RefreshCw size={16} />同步订阅</button>}
      </div>
    </div>
    {loading ? <p className="muted">正在读取订阅</p> : <>
      {subscription?.entitlements.length ? <dl className="billing-entitlements">{subscription.entitlements.map((item) => <div key={item.entitlement_key}><dt><Check size={15} />{item.entitlement_key}</dt><dd>{date(item.valid_until)}</dd></div>)}</dl> : null}
      <h2>套餐</h2>
      <div className="billing-plans">{plans.map((plan) => <article className="billing-plan" key={plan.id}>
        <h3>{plan.name ?? plan.id}</h3><p className="muted billing-description">{plan.description ?? "套餐同步中"}</p>
        <p className="billing-price">{plan.price_cents === null ? "待同步" : money(plan.price_cents)}<small>{plan.permanent ? " / 永久" : ""}</small></p>
        <div className="billing-purchase">
          {!plan.permanent && <label>时长<select aria-label={`${plan.name ?? plan.id}订阅时长`} value={months[plan.id] ?? plan.pay_month ?? 1} onChange={(event) => setMonths({ ...months, [plan.id]: Number(event.target.value) })}>
            {[1, 3, 6, 12, 24, 36].filter((m) => m % (plan.pay_month ?? 1) === 0).map((m) => <option key={m} value={m}>{m} 个月</option>)}
          </select></label>}
          <button disabled={disabled || !plan.available} onClick={() => void act(async () => {
            const next = await request<{ url: string }>("/v1/billing/afdian/checkout", "POST", { plan_id: plan.id, months: plan.permanent ? 1 : months[plan.id] ?? plan.pay_month ?? 1 }, crypto.randomUUID());
            location.href = next.url;
          })}><ArrowUpRight size={16} />{plan.available ? "前往爱发电" : "暂未开放"}</button>
        </div>
      </article>)}</div>
      {!plans.length && <p className="muted">暂无已发布套餐</p>}
      <h2>订单核销</h2>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void act(() => startTask("/v1/billing/afdian/redeem", { order_id: orderId.trim() })); }}>
        <label>爱发电订单号<input required maxLength={128} pattern="[a-zA-Z0-9_-]+" value={orderId} onChange={(event) => setOrderId(event.target.value)} /></label>
        <button disabled={disabled || !orderId.trim()} type="submit"><Check size={16} />核销订单</button>
      </form>
      <h2>我的订单</h2>
      <div className="table-scroll"><table><thead><tr><th>订单</th><th>套餐</th><th>实付</th><th>状态</th><th>有效期至</th></tr></thead><tbody>
        {orders.slice(0, 20).map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.name ?? "未配置"}</td><td>{money(order.amount_cents)}</td><td>{stateNames[order.state] ?? order.state}</td><td>{order.state === "granted" ? date(order.valid_until) : "待确认"}</td></tr>)}
        {!orders.length && <tr><td colSpan={5}>暂无订单</td></tr>}
      </tbody></table></div>
      <div className="billing-pagination"><button title="上一页" aria-label="上一页" disabled={!page || busy} onClick={() => setPage(page - 1)}><ArrowLeft size={16} /></button><span>第 {page + 1} 页</span><button title="下一页" aria-label="下一页" disabled={orders.length <= 20 || busy} onClick={() => setPage(page + 1)}><ArrowRight size={16} /></button></div>
    </>}
    {admin && <>
      <div className="section-bar"><h2>支付运行状态</h2><button disabled={disabled} onClick={() => void act(() => startTask("/v1/admin/billing/sync", undefined, true))}><RefreshCw size={16} />完整对账</button></div>
      <p className="muted">{status?.orders.map((s) => `${stateNames[s.state] ?? s.state} ${s.count}`).join(" · ") || "暂无订单"}</p>
      <div className="table-scroll"><table><thead><tr><th>任务</th><th>状态</th><th>异常</th><th>操作</th></tr></thead><tbody>
        {status?.tasks.filter((t) => t.status === "failed" || t.status === "retrying").slice(0, 20).map((t) => <tr key={t.id}><td>{t.id}</td><td>{stateNames[t.status]}</td><td>{t.error_code}</td><td><button title="重试任务" aria-label="重试任务" disabled={disabled || t.status !== "failed"} onClick={() => void act(() => startTask(`/v1/admin/billing/tasks/${t.id}/retry`, undefined, true))}><RefreshCw size={16} /></button></td></tr>)}
        {!status?.tasks.some((t) => ["failed", "retrying"].includes(t.status)) && <tr><td colSpan={4}>暂无异常任务</td></tr>}
      </tbody></table></div>
    </>}
  </section>;
}
