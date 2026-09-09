import { useEffect, useState } from "react";
import { Check, FileDown, FileUp, RefreshCw, Save, ShieldCheck } from "lucide-react";

type Client = <T>(path: string, method?: string, body?: unknown, key?: string) => Promise<T>;
type ConfigData = { version: number; document: Record<string, unknown>; template: Record<string, unknown> };
type Validation = { valid: boolean; changed_paths: string[]; restart_required: string[]; applied_hot: string[] };
type Audit = { version: number; actor_id: string; source: string; changed_paths: string[]; restart_required: string[]; created_at: string };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const labels: Record<string, string> = { server: "服务进程", database: "数据库", auth: "统一身份", integrations: "外部组件", "integrations.afdian": "爱发电", "integrations.webhook_targets": "Webhook 目标" };
function title(path: string) { const key = path.split(".").slice(0, 2).join("."); return labels[key] ?? labels[path] ?? path; }

export function ConfigPanel({ request }: { request: Client }) {
  const [data, setData] = useState<ConfigData | null>(null);
  const [text, setText] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    const [config, history] = await Promise.all([request<ConfigData>("/v1/admin/config"), request<{ items: Audit[] }>("/v1/admin/config/audit")]);
    setData(config); setText(pretty(config.document)); setAudit(history.items);
  }
  useEffect(() => { void load().catch((e) => setError((e as Error).message)); }, []);
  async function parse() {
    try {
      const document = JSON.parse(text) as Record<string, unknown>;
      setValidation(await request<Validation>("/v1/admin/config/validate", "POST", { document })); setError("");
    } catch (e) { setError((e as Error).message); setValidation(null); }
  }
  async function apply() {
    if (!data) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const document = JSON.parse(text) as Record<string, unknown>;
      const result = await request<Validation & { version: number }>("/v1/admin/config/upload", "POST", { document, if_version: data.version });
      setNotice(result.restart_required.length ? `已应用 ${result.applied_hot.length} 项，${[...new Set(result.restart_required.map(title))].join("、")}需要重启` : "配置已热更新");
      await load(); setValidation(result);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function download() {
    if (!data) return;
    const blob = new Blob([pretty(data.template)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "sm-unified-config.json"; link.click(); URL.revokeObjectURL(url);
  }
  function upload(file: File) {
    const reader = new FileReader(); reader.onload = () => { setText(String(reader.result)); setValidation(null); setError(""); }; reader.onerror = () => setError("配置文件读取失败"); reader.readAsText(file, "utf-8");
  }
  return <section className="config-panel">
    <div className="section-bar"><h2>统一配置</h2><button title="重新读取" aria-label="重新读取" disabled={busy} onClick={() => void load()}><RefreshCw size={17} /></button></div>
    <p className="muted">配置版本 {data?.version ?? "-"} · 密钥以星号显示，上传后先校验再应用。</p>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    <div className="toolbar config-actions">
      <label className="file-button"><FileUp size={16} />载入 JSON<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.currentTarget.value = ""; }} /></label>
      <button onClick={download} disabled={!data}><FileDown size={16} />下载模板</button>
      <button onClick={() => void parse()} disabled={busy || !text}><ShieldCheck size={16} />校验变更</button>
      <button className="primary" onClick={() => void apply()} disabled={busy || !validation?.valid || !data}><Save size={16} />应用配置</button>
    </div>
    <label className="config-editor">配置 JSON<textarea value={text} onChange={(event) => { setText(event.target.value); setValidation(null); }} spellCheck={false} /></label>
    {validation && <div className="config-result"><strong><Check size={15} />校验通过</strong><span>变更 {validation.changed_paths.length} 项</span>{validation.applied_hot.length > 0 && <span>热更新 {validation.applied_hot.length} 项</span>}{validation.restart_required.length > 0 && <span>需重启 {validation.restart_required.map(title).join("、")}</span>}</div>}
    <h2>变更记录</h2><div className="table-scroll"><table><thead><tr><th>版本</th><th>来源</th><th>变更</th><th>重启</th><th>时间</th></tr></thead><tbody>{audit.map((item) => <tr key={`${item.version}-${item.created_at}`}><td>{item.version}</td><td>{item.source}</td><td>{item.changed_paths.length || "无"}</td><td>{item.restart_required.length ? item.restart_required.map(title).join("、") : "热更新"}</td><td>{new Date(item.created_at).toLocaleString("zh-CN", { hour12: false })}</td></tr>)}{!audit.length && <tr><td colSpan={5}>暂无变更记录</td></tr>}</tbody></table></div>
  </section>;
}
