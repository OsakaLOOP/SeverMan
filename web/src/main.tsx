import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import QRCode from "qrcode";
import {
  Boxes,
  LayoutGrid,
  ListTodo,
  Database,
  Shield,
  CreditCard,
  Settings,
  LogOut,
  RefreshCw,
  Plus,
  ArrowUpRight,
  Upload,
  Check,
  X,
  GitBranch as Github,
  Activity,
  Copy,
  UserRound,
} from "lucide-react";
import "./style.css";

const auth = createAuthClient({
  plugins: [twoFactorClient(), oauthProviderClient()],
});
type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
};
type Me = { user: User; admin: boolean; admin_ready: boolean };
type Service = {
  id: string;
  display_name: string;
  origin: string;
  state: string;
  version: number;
};
type Operation = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  error_code?: string;
};
type Resource = { id: string; service_id: string; columns: string[] };
type SettingsType = {
  github: boolean;
  storage: boolean;
  mail: boolean;
  billing: boolean;
  prices: string[];
};
const messages: Record<string, string> = {
  AUTH_REQUIRED: "请先登录",
  ADMIN_REQUIRED: "需要管理员权限",
  TWO_FACTOR_REQUIRED: "请先启用二次验证",
  VERSION_CONFLICT: "数据已更新，请刷新后重试",
  MAIL_UNAVAILABLE: "邮件服务暂不可用",
  STORAGE_UNAVAILABLE: "存储服务尚未配置",
  BILLING_UNAVAILABLE: "支付服务尚未配置",
  SERVICE_EXISTS: "服务标识已存在",
  ORIGIN_REJECTED: "请求来源未授权",
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      messages[data.error?.code] ?? data.error?.code ?? "请求失败",
    );
  return data;
}
function check(result: { error?: { message?: string } | null }) {
  if (result.error) throw new Error(result.error.message ?? "操作失败");
}
const labels: Record<string, string> = {
  pending: "等待中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  active: "已启用",
  disabled: "已暂停",
  snapshot: "数据快照",
  webhook: "Webhook",
  mail: "邮件",
  command: "服务命令",
};

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsType>({
    github: false,
    storage: false,
    mail: false,
    billing: false,
    prices: [],
  });
  const [tab, setTab] = useState("services");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [sessions, setSessions] = useState<
    {
      id: string;
      token: string;
      userAgent?: string | null;
      createdAt: Date;
      expiresAt: Date;
    }[]
  >([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [modal, setModal] = useState(false);
  const [clientSecret, setClientSecret] = useState<unknown>(null);
  const [qr, setQr] = useState("");
  const [backups, setBackups] = useState<string[]>([]);
  const [mode, setMode] = useState(
    location.pathname === "/sign-up"
      ? "signup"
      : location.pathname === "/reset-password"
        ? "reset"
        : "signin",
  );
  const [otp, setOtp] = useState(false);
  const [backupMode, setBackupMode] = useState(false);
  const [railroundProfile, setRailroundProfile] = useState<Record<string, unknown> | null>(null);

  async function refresh() {
    const current = await api<Me>("/v1/me");
    setMe(current);
    const [s, o, r] = await Promise.all([
      api<{ items: Service[] }>(
        current.admin_ready ? "/v1/admin/services" : "/v1/services",
      ),
      api<{ items: Operation[] }>("/v1/operations"),
      api<{ items: Resource[] }>("/v1/resources"),
    ]);
    setServices(s.items);
    setOperations(o.items);
    setResources(r.items);
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api<SettingsType>("/v1/config")
      .then(setSettings)
      .catch(() => {});
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (tab !== "operations" || !me) return;
    const timer = setInterval(() => {
      if (!document.hidden)
        api<{ items: Operation[] }>("/v1/operations")
          .then((r) => setOperations(r.items))
          .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [tab, me?.user.id]);
  useEffect(() => {
    if (tab !== "railround" || !me) return;
    api<{ profile: Record<string, unknown> | null }>("/v1/site-profiles/railround")
      .then((response) => setRailroundProfile(response.profile))
      .catch((error) => setError(error instanceof Error ? error.message : "RailRound 资料暂不可用"));
  }, [tab, me?.user.id]);
  useEffect(() => {
    if (tab === "security" && me)
      auth
        .listSessions()
        .then((r) => {
          check(r);
          setSessions(r.data ?? []);
        })
        .catch((e) => setError(String(e)));
  }, [tab, me?.user.id]);
  const form = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return new FormData(event.currentTarget);
  };

  if (loading)
    return (
      <main className="initial">
        <Boxes size={28} />
        <p>正在连接服务中心</p>
      </main>
    );
  if (!me)
    return (
      <main className="auth-page">
        <div className="brand">
          <Boxes />
          <strong>SM 服务中心</strong>
        </div>
        <section className="auth-form">
          <span className="eyebrow">统一账号</span>
          <h1>
            {otp
              ? "二次验证"
              : mode === "signup"
                ? "创建账号"
                : mode === "forgot"
                  ? "找回密码"
                  : mode === "reset"
                    ? "设置新密码"
                    : "登录"}
          </h1>
          <p className="muted">
            {mode === "signup"
              ? "使用一个账号访问已接入的服务。"
              : "管理你的服务、资料与登录设备。"}
          </p>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          <form
            onSubmit={(e) => {
              const data = form(e);
              void act(async () => {
                if (otp) {
                  check(
                    await (backupMode ? auth.twoFactor.verifyBackupCode({ code: String(data.get("code")) }) : auth.twoFactor.verifyTotp({ code: String(data.get("code")) })),
                  );
                  await refresh();
                  return;
                }
                if (mode === "forgot") {
                  check(
                    await auth.requestPasswordReset({
                      email: String(data.get("email")),
                      redirectTo: `${location.origin}/reset-password`,
                    }),
                  );
                  setNotice("若邮箱已注册，重置邮件将发送到该邮箱。");
                  return;
                }
                if (mode === "reset") {
                  check(
                    await auth.resetPassword({
                      newPassword: String(data.get("password")),
                      token:
                        new URLSearchParams(location.search).get("token") ?? "",
                    }),
                  );
                  setMode("signin");
                  setNotice("密码已更新，请登录。");
                  return;
                }
                const credentials = {
                  email: String(data.get("email")),
                  password: String(data.get("password")),
                  callbackURL: location.origin,
                };
                const response =
                  mode === "signup"
                    ? await auth.signUp.email({
                        ...credentials,
                        name: String(data.get("name")),
                      })
                    : await auth.signIn.email(credentials);
                check(response);
                if (
                  response.data &&
                  "twoFactorRedirect" in response.data &&
                  response.data.twoFactorRedirect
                ) {
                  setOtp(true);
                  return;
                }
                if (mode === "signup") {
                  setNotice("账号已创建，请查收验证邮件。");
                  setMode("signin");
                } else await refresh();
              });
            }}
          >
            {otp ? (
              <label>
                {backupMode ? "恢复码" : "验证码"}
                <input
                  name="code"
                  inputMode={backupMode ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  required
                  pattern={backupMode ? undefined : "[0-9]{6}"}
                />
              </label>
            ) : (
              <>
                {mode === "signup" && (
                  <label>
                    昵称
                    <input
                      name="name"
                      autoComplete="nickname"
                      required
                      maxLength={100}
                    />
                  </label>
                )}
                {mode !== "reset" && (
                  <label>
                    邮箱
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </label>
                )}
                {mode !== "forgot" && (
                  <label>
                    密码
                    <input
                      name="password"
                      type="password"
                      minLength={12}
                      autoComplete={
                        mode === "signin" ? "current-password" : "new-password"
                      }
                      required
                    />
                  </label>
                )}
              </>
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? "处理中…"
                : otp
                  ? "验证"
                  : mode === "signup"
                    ? "注册"
                    : mode === "forgot"
                      ? "发送重置邮件"
                      : mode === "reset"
                        ? "更新密码"
                        : "登录"}
            </button>
          </form>
          {otp && <button className="full" onClick={() => setBackupMode(!backupMode)}>{backupMode ? "使用验证器" : "使用恢复码"}</button>}
          {settings.github && (
            <button
              className="full"
              onClick={() =>
                void act(async () => {
                  check(
                    await auth.signIn.social({
                      provider: "github",
                      callbackURL: location.origin,
                    }),
                  );
                })
              }
            >
              <Github size={17} />
              使用 GitHub 登录
            </button>
          )}
          <div className="auth-links">
            <button
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setOtp(false);
              }}
            >
              {mode === "signup" ? "已有账号" : "创建账号"}
            </button>
            <button
              onClick={() => {
                setMode("forgot");
                setOtp(false);
              }}
            >
              忘记密码
            </button>
          </div>
        </section>
        <footer>SM · 统一身份与服务</footer>
      </main>
    );

  const tabs = [
    { id: "services", label: "服务", icon: LayoutGrid },
    { id: "operations", label: "任务", icon: ListTodo },
    { id: "data", label: "数据", icon: Database },
    { id: "railround", label: "RailRound资料", icon: UserRound },
    { id: "security", label: "账号安全", icon: Shield },
    { id: "billing", label: "订阅", icon: CreditCard },
    ...(me.admin ? [{ id: "admin", label: "管理", icon: Settings }] : []),
  ];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <Boxes size={25} />
          <strong>SM 服务中心</strong>
        </div>
        <nav>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              onClick={() => {
                setTab(id);
                setResult(null);
                setError("");
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="account">
          <span className="avatar">{me.user.name.slice(0, 1)}</span>
          <div>
            <strong>{me.user.name}</strong>
            <small>{me.admin ? "管理员" : "个人账号"}</small>
          </div>
          <button
            title="退出"
            aria-label="退出"
            className="icon"
            onClick={() =>
              void act(async () => {
                check(await auth.signOut());
                setMe(null);
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div>
            <span className="eyebrow">个人工作区</span>
            <h1>{tabs.find((t) => t.id === tab)?.label}</h1>
          </div>
          <div className="header-actions">
            <span className="connected">
              <i />
              已连接
            </span>
            <button
              className="icon"
              title="刷新"
              aria-label="刷新"
              disabled={busy}
              onClick={() => void act(refresh)}
            >
              <RefreshCw size={18} />
            </button>
            {tab === "services" && me.admin_ready && (
              <button
                className="primary"
                onClick={() => {
                  setModal(true);
                  setClientSecret(null);
                }}
              >
                <Plus size={17} />
                注册服务
              </button>
            )}
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button className="icon" title="关闭" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {location.pathname === "/consent" && (
          <section>
            <h2>授权服务访问账号</h2>
            <p>{new URLSearchParams(location.search).get("scope")}</p>
            <button
              className="primary"
              onClick={() =>
                void act(async () => {
                  const r = await auth.oauth2.consent({ accept: true });
                  check(r);
                  if (r.data && "url" in r.data) location.href = r.data.url;
                })
              }
            >
              授权
            </button>
            <button onClick={() => void act(async () => { const r = await auth.oauth2.consent({ accept: false }); check(r); if (r.data && "url" in r.data) location.href = r.data.url; })}>拒绝</button>
          </section>
        )}
        {tab === "services" && (
          <>
            <div className="summary">
              <div>
                <span>已接入服务</span>
                <strong>{services.length}</strong>
              </div>
              <div>
                <span>运行中</span>
                <strong>
                  {services.filter((s) => s.state === "active").length}
                </strong>
              </div>
              <div>
                <span>数据资源</span>
                <strong>{resources.length}</strong>
              </div>
            </div>
            <div className="section-bar">
              <h2>服务目录</h2>
              <input
                aria-label="搜索服务"
                placeholder="搜索服务"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="services">
              {services
                .filter((s) => `${s.id} ${s.display_name}`.includes(query))
                .map((service, index) => (
                  <article className="service" key={service.id}>
                    <div className={`service-icon color-${index % 3}`}>
                      <Boxes size={24} />
                    </div>
                    <div className="service-title">
                      <h3>{service.display_name}</h3>
                      <small>{service.id}</small>
                    </div>
                    <span className={`badge ${service.state}`}>
                      {labels[service.state]}
                    </span>
                    <p>{service.origin ?? "尚未配置站点地址"}</p>
                    <div className="service-actions">
                      {service.origin && service.state === "active" && (
                        <a
                          href={service.origin}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开服务
                          <ArrowUpRight size={16} />
                        </a>
                      )}
                      {me.admin_ready && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await api(
                                `/v1/admin/services/${service.id}`,
                                "PATCH",
                                {
                                  state:
                                    service.state === "active"
                                      ? "disabled"
                                      : "active",
                                  version: service.version,
                                },
                              );
                              await refresh();
                            })
                          }
                        >
                          {service.state === "active" ? "暂停接入" : "启用"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
            </div>
            {!services.length && (
              <div className="empty">
                <LayoutGrid />
                <h3>暂无服务</h3>
                <p>
                  {me.admin_ready
                    ? "注册首个服务后即可接入统一登录。"
                    : "已接入的服务将在这里显示。"}
                </p>
              </div>
            )}
          </>
        )}
        {tab === "operations" && (
          <>
            <div className="section-bar">
              <h2>最近任务</h2>
              <span className="muted">{operations.length} 条</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>标识</th>
                    <th>状态</th>
                    <th>尝试次数</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => (
                    <tr key={op.id}>
                      <td>{labels[op.kind]}</td>
                      <td className="mono">{op.id.slice(0, 8)}</td>
                      <td>
                        <span className={`badge ${op.status}`}>
                          {labels[op.status]}
                        </span>
                        {op.error_code && <small>{op.error_code}</small>}
                      </td>
                      <td>{op.attempts}</td>
                      <td>
                        <button
                          onClick={() =>
                            void act(async () =>
                              setResult(await api(`/v1/operations/${op.id}`)),
                            )
                          }
                        >
                          查看
                        </button>
                        {op.status === "pending" && op.attempts === 0 && (
                          <button
                            title="取消"
                            className="icon"
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  `/v1/operations/${op.id}/cancel`,
                                  "POST",
                                );
                                await refresh();
                              })
                            }
                          >
                            <X size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!operations.length && (
              <div className="empty">
                <ListTodo />
                <h3>暂无任务</h3>
              </div>
            )}
            {result !== null && <pre>{JSON.stringify(result, null, 2)}</pre>}
          </>
        )}
        {tab === "data" && (
          <section>
            <h2>个人数据</h2>
            <form
              className="inline-form"
              onSubmit={(e) => {
                const data = form(e);
                void act(async () => {
                  const resource = String(data.get("resource"));
                  const async = data.get("async") === "on";
                  setResult(
                    await api(
                      async ? "/v1/operations" : "/v1/query",
                      "POST",
                      async
                        ? { kind: "snapshot", resources: [resource] }
                        : { resources: [resource] },
                      async ? crypto.randomUUID() : undefined,
                    ),
                  );
                  await refresh();
                });
              }}
            >
              <label>
                资源
                <select name="resource" required>
                  {!resources.length && <option value="">暂无可读资源</option>}
                  {resources.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox">
                <input name="async" type="checkbox" />
                后台生成快照
              </label>
              <button className="primary" disabled={busy || !resources.length}>
                查询
              </button>
            </form>
            {result !== null && <pre>{JSON.stringify(result, null, 2)}</pre>}
            <h2>图片上传</h2>
            <label className="upload">
              <Upload size={20} />
              <span>{settings.storage ? "选择图片" : "存储服务尚未配置"}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                disabled={!settings.storage || busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void act(async () => {
                    const ticket = await api<{
                      id: string;
                      url: string;
                      headers: Record<string, string>;
                    }>("/v1/uploads", "POST", {
                      content_type: file.type,
                      size: file.size,
                    });
                    const uploaded = await fetch(ticket.url, {
                      method: "PUT",
                      headers: ticket.headers,
                      body: file,
                    });
                    if (!uploaded.ok) throw new Error("上传失败");
                    await api(`/v1/uploads/${ticket.id}/confirm`, "POST");
                    setNotice("图片已上传");
                  });
                }}
              />
            </label>
          </section>
        )}
        {tab === "railround" && (
          <section>
            <h2>RailRound 资料</h2>
            <p className="muted">仅显示 RailRound 明确发布的资料字段。行程、图钉、文件、登录凭据和订阅凭据由 RailRound 独立管理。</p>
            {railroundProfile ? (
              <div className="profile-grid">
                <div><span>显示名称</span><strong>{String(railroundProfile.display_name ?? "未设置")}</strong></div>
                <div><span>会员等级</span><strong>{String(railroundProfile.tier ?? "free")}</strong></div>
                <div><span>累计行程</span><strong>{String(railroundProfile.total_trips ?? 0)}</strong></div>
                <div><span>累计距离</span><strong>{String(railroundProfile.total_distance_km ?? 0)} km</strong></div>
                <div><span>涉及线路</span><strong>{String(railroundProfile.total_lines ?? 0)}</strong></div>
                <div><span>公开徽章</span><strong>{railroundProfile.public_badge_enabled ? "已启用" : "已关闭"}</strong></div>
              </div>
            ) : (
              <div className="empty"><UserRound /><h3>RailRound 资料尚未发布</h3><p>完成 RailRound 数据库迁移并登记只读视图后，这里会显示专用资料。</p></div>
            )}
          </section>
        )}
        {tab === "security" && (
          <section>
            <h2>账号资料</h2>
            <p>
              {me.user.email}{" "}
              <span className="badge">
                {me.user.emailVerified ? "已验证" : "待验证"}
              </span>
            </p>
            <form
              className="inline-form"
              onSubmit={(e) => {
                const data = form(e);
                void act(async () => {
                  check(
                    await auth.updateUser({ name: String(data.get("name")) }),
                  );
                  await refresh();
                  setNotice("资料已保存");
                });
              }}
            >
              <label>
                昵称
                <input
                  name="name"
                  defaultValue={me.user.name}
                  required
                  maxLength={100}
                />
              </label>
              <button className="primary" disabled={busy}>
                保存
              </button>
            </form>
            {settings.github && (
              <button
                onClick={() =>
                  void act(async () => {
                    check(
                      await auth.linkSocial({
                        provider: "github",
                        callbackURL: location.origin,
                      }),
                    );
                  })
                }
              >
                <Github size={17} />
                关联 GitHub
              </button>
            )}
            <h2>修改密码</h2>
            <form className="inline-form" onSubmit={(e) => { const data = form(e); void act(async () => { check(await auth.changePassword({ currentPassword: String(data.get("currentPassword")), newPassword: String(data.get("newPassword")), revokeOtherSessions: true })); setNotice("密码已更新，其他设备已退出。"); }); }}>
              <label>原密码<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
              <label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
              <button disabled={busy}>更新密码</button>
            </form>
            <h2>二次验证</h2>
            <p className="muted">
              {me.user.twoFactorEnabled
                ? "已启用验证器保护"
                : "管理员操作需要启用验证器。"}
            </p>
            {!me.user.twoFactorEnabled && (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  const data = form(e);
                  void act(async () => {
                    const r = await auth.twoFactor.enable({
                      password: String(data.get("password")),
                    });
                    check(r);
                    if (r.data && "totpURI" in r.data) {
                      setQr(await QRCode.toDataURL(r.data.totpURI));
                      setBackups(r.data.backupCodes);
                    }
                  });
                }}
              >
                <label>
                  当前密码
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <button disabled={busy}>设置验证器</button>
              </form>
            )}
            {qr && (
              <div className="totp">
                <img width={180} height={180} src={qr} alt="验证器二维码" />
                <form
                  onSubmit={(e) => {
                    const data = form(e);
                    void act(async () => {
                      check(
                        await auth.twoFactor.verifyTotp({
                          code: String(data.get("code")),
                        }),
                      );
                      setQr("");
                      await refresh();
                      setNotice("二次验证已启用，请妥善保管恢复码。");
                    });
                  }}
                >
                  <label>
                    验证码
                    <input
                      name="code"
                      inputMode="numeric"
                      required
                      pattern="[0-9]{6}"
                    />
                  </label>
                  <button className="primary">确认启用</button>
                </form>
              </div>
            )}
            {backups.length > 0 && (
              <div>
                <h3>恢复码</h3>
                <pre>{backups.join("\n")}</pre>
                <button
                  onClick={() => {
                    setBackups([]);
                  }}
                >
                  已妥善保存
                </button>
              </div>
            )}
            <h2>登录设备</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>设备</th>
                    <th>登录时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.userAgent?.slice(0, 70) || "未知设备"}</td>
                      <td>{new Date(s.createdAt).toLocaleString()}</td>
                      <td>
                        <button
                          onClick={() =>
                            void act(async () => {
                              check(
                                await auth.revokeSession({ token: s.token }),
                              );
                              setSessions((old) =>
                                old.filter((i) => i.id !== s.id),
                              );
                            })
                          }
                        >
                          撤销
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="danger"
              onClick={() =>
                void act(async () => {
                  await api("/v1/sign-out-all", "POST");
                  await auth.signOut();
                  setMe(null);
                })
              }
            >
              退出全部设备
            </button>
          </section>
        )}
        {tab === "billing" && (
          <section>
            <h2>订阅状态</h2>
            <p className="muted">
              {settings.billing
                ? "选择已发布的订阅方案。"
                : "订阅服务尚未开放。"}
            </p>
            <button
              onClick={() =>
                void act(async () =>
                  setResult(await api("/v1/billing/subscription")),
                )
              }
            >
              查询订阅
            </button>
            {settings.prices.map((price) => (
              <button
                key={price}
                onClick={() =>
                  void act(async () => {
                    const r = await api<{ url: string }>(
                      "/v1/billing/checkout",
                      "POST",
                      { price_id: price },
                      crypto.randomUUID(),
                    );
                    location.href = r.url;
                  })
                }
              >
                {price}
              </button>
            ))}
            {result !== null && <pre>{JSON.stringify(result, null, 2)}</pre>}
          </section>
        )}
        {tab === "admin" && (
          <section>
            <h2>运行状态</h2>
            {!me.admin_ready && (
              <div className="notice">请在账号安全中启用二次验证。</div>
            )}
            <div className="toolbar">
              <button
                disabled={!me.admin_ready}
                onClick={() =>
                  void act(async () => setResult(await api("/v1/admin/status")))
                }
              >
                <Activity size={17} />
                检查状态
              </button>
              <button
                disabled={!me.admin_ready}
                onClick={() =>
                  void act(async () => setResult(await api("/v1/admin/audit")))
                }
              >
                审计记录
              </button>
            </div>
            {result !== null && <pre>{JSON.stringify(result, null, 2)}</pre>}
          </section>
        )}
        <footer>
          SM 服务中心<span>{me.user.email}</span>
        </footer>
      </main>
      {modal && (
        <div className="overlay" onClick={() => setModal(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="注册服务"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-bar">
              <h2>注册服务</h2>
              <button
                className="icon"
                title="关闭"
                onClick={() => setModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            {clientSecret ? (
              <>
                <p>客户端密钥仅显示一次。</p>
                <pre>{JSON.stringify(clientSecret, null, 2)}</pre>
                <button
                  onClick={() =>
                    void act(async () => {
                      await navigator.clipboard.writeText(
                        JSON.stringify(clientSecret, null, 2),
                      );
                      setNotice("已复制客户端配置");
                    })
                  }
                >
                  <Copy size={16} />
                  复制配置
                </button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  const data = form(e);
                  void act(async () => {
                    setClientSecret(
                      await api(
                        "/v1/admin/services",
                        "POST",
                        Object.fromEntries(data),
                      ),
                    );
                    await refresh();
                  });
                }}
              >
                <label>
                  服务名称
                  <input name="display_name" required maxLength={100} />
                </label>
                <label>
                  服务标识
                  <input
                    name="id"
                    required
                    pattern="[a-z][a-z0-9_-]*"
                    maxLength={63}
                  />
                </label>
                <label>
                  站点来源
                  <input
                    name="origin"
                    type="url"
                    placeholder="https://app.example.com"
                    required
                  />
                </label>
                <label>
                  登录回调
                  <input
                    name="redirect_uri"
                    type="url"
                    placeholder="https://app.example.com/auth/callback"
                    required
                  />
                </label>
                <button className="primary full" disabled={busy}>
                  注册服务
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
