import { createHash, createPublicKey } from "node:crypto";
import type { Pool } from "pg";
import type { Config } from "./config.js";
import type { AfdianConfig } from "./afdian-client.js";
import type { PlatformConfig } from "./platform-config.js";
import { HttpError } from "./errors.js";
import { seal, unseal } from "./security.js";

export interface UnifiedConfigDocument {
  schema_version: 1;
  server: { host: string; port: number; log_level: string; trusted_proxy_cidrs: string[] };
  database: { database_url: string; read_database_url: string; auth_database_url: string; queue_database_url: string };
  auth: { origin: string; secret: string; require_verification: boolean };
  integrations: {
    github: { client_id: string; client_secret: string } | null;
    smtp: { host: string; port: number; secure: boolean; user: string; password: string; from: string } | null;
    storage: { endpoint: string; region: string; bucket: string; key_id: string; key_secret: string } | null;
    afdian: (AfdianConfig & { user_id?: string }) | null;
    webhook_targets: PlatformConfig["webhookTargets"];
  };
}

const keys = {
  server: ["host", "port", "log_level", "trusted_proxy_cidrs"],
  database: ["database_url", "read_database_url", "auth_database_url", "queue_database_url"],
  auth: ["origin", "secret", "require_verification"],
  integrations: ["github", "smtp", "storage", "afdian", "webhook_targets"],
};
const restartPaths = ["server.host", "server.port", "server.log_level", "server.trusted_proxy_cidrs", "database", "auth.origin", "auth.secret", "auth.require_verification", "integrations.github", "integrations.smtp", "integrations.storage", "integrations.afdian.userId"];
const plain = (value: unknown, path: string) => {
  if (typeof value !== "string" || value.length > 16384) throw new HttpError(400, "CONFIG_INVALID", `${path} 配置值无效`);
  return value;
};
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "CONFIG_INVALID", `${path} 必须是对象`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, expected: readonly string[], path: string) {
  if (Object.keys(value).some((key) => !expected.includes(key))) throw new HttpError(400, "CONFIG_INVALID", `${path} 包含未知字段`);
}
function nullableObject(value: unknown, path: string, expected: readonly string[]) {
  if (value === null) return null;
  const result = object(value, path); exact(result, expected, path); return result;
}
export function validateConfigDocument(value: unknown): UnifiedConfigDocument {
  const root = object(value, "config"); exact(root, ["schema_version", "server", "database", "auth", "integrations"], "config");
  if (root.schema_version !== 1) throw new HttpError(400, "CONFIG_VERSION_UNSUPPORTED");
  const server = object(root.server, "server"); exact(server, keys.server, "server");
  const port = server.port; if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new HttpError(400, "CONFIG_INVALID");
  const proxies = server.trusted_proxy_cidrs; if (!Array.isArray(proxies) || proxies.some((item) => typeof item !== "string" || item.length > 100)) throw new HttpError(400, "CONFIG_INVALID");
  const database = object(root.database, "database"); exact(database, keys.database, "database");
  for (const key of keys.database) { const item = plain(database[key], `database.${key}`); if (item !== "***") { try { const parsed = new URL(item); if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) throw new Error(); } catch { throw new HttpError(400, "CONFIG_INVALID", `${key} 必须是 PostgreSQL 地址`); } } }
  const auth = object(root.auth, "auth"); exact(auth, keys.auth, "auth"); plain(auth.origin, "auth.origin"); plain(auth.secret, "auth.secret");
  if (auth.secret !== "***" && String(auth.secret).length < 32 || typeof auth.require_verification !== "boolean") throw new HttpError(400, "CONFIG_INVALID");
  try { if (!["http:", "https:"].includes(new URL(String(auth.origin)).protocol)) throw new Error(); } catch { throw new HttpError(400, "CONFIG_INVALID", "auth.origin 必须是 HTTP(S) 地址"); }
  const integrations = object(root.integrations, "integrations"); exact(integrations, keys.integrations, "integrations");
  for (const [name, expected] of [["github", ["client_id", "client_secret"]], ["smtp", ["host", "port", "secure", "user", "password", "from"]], ["storage", ["endpoint", "region", "bucket", "key_id", "key_secret"]]] as const) {
    const item = nullableObject(integrations[name], `integrations.${name}`, expected);
    if (item) for (const [key, itemValue] of Object.entries(item)) key === "port" ? (Number.isInteger(itemValue) || (() => { throw new HttpError(400, "CONFIG_INVALID"); })()) : key === "secure" ? (typeof itemValue === "boolean" || (() => { throw new HttpError(400, "CONFIG_INVALID"); })()) : plain(itemValue, `integrations.${name}.${key}`);
  }
  const afdian = nullableObject(integrations.afdian, "integrations.afdian", ["userId", "token", "publicKey", "plans", "oauth"]);
  if (afdian) {
    plain(afdian.userId, "integrations.afdian.userId"); plain(afdian.token, "integrations.afdian.token"); plain(afdian.publicKey, "integrations.afdian.publicKey");
    if (afdian.userId !== "***" && !/^[a-f0-9]{32}$/.test(String(afdian.userId))) throw new HttpError(400, "CONFIG_INVALID", "爱发电用户 ID 无效");
    if (afdian.token !== "***" && String(afdian.token).length < 8) throw new HttpError(400, "CONFIG_INVALID", "爱发电 API 令牌无效");
    if (afdian.publicKey !== "***") { try { if (createPublicKey(String(afdian.publicKey)).asymmetricKeyType !== "rsa") throw new Error(); } catch { throw new HttpError(400, "CONFIG_INVALID", "爱发电公钥无效"); } }
    if (!Array.isArray(afdian.plans) || afdian.plans.length > 30) throw new HttpError(400, "CONFIG_INVALID");
    const planIds = new Set<string>(); const remotePlanIds = new Set<string>();
    for (const plan of afdian.plans) {
      const item = object(plan, "integrations.afdian.plans");
      exact(item, ["id", "planId", "entitlements", "permanent", "enabled"], "integrations.afdian.plans");
      if (typeof item.id !== "string" || !/^[a-z][a-z0-9_-]{0,49}$/.test(item.id) || typeof item.planId !== "string" || !/^[a-f0-9]{32}$/.test(item.planId)
        || !Array.isArray(item.entitlements) || item.entitlements.length < 1 || item.entitlements.length > 30
        || item.entitlements.some((key) => typeof key !== "string" || !/^[a-z][a-z0-9_.:-]{0,99}$/.test(key))
        || typeof item.permanent !== "boolean" || typeof item.enabled !== "boolean") throw new HttpError(400, "CONFIG_INVALID", "爱发电套餐规则无效");
      if (planIds.has(item.id) || remotePlanIds.has(item.planId)) throw new HttpError(400, "CONFIG_INVALID", "爱发电套餐标识必须唯一");
      planIds.add(item.id); remotePlanIds.add(item.planId);
    }
    if (afdian.oauth !== undefined && afdian.oauth !== null) { const oauth = object(afdian.oauth, "integrations.afdian.oauth"); exact(oauth, ["clientId", "clientSecret"], "integrations.afdian.oauth"); plain(oauth.clientId, "integrations.afdian.oauth.clientId"); plain(oauth.clientSecret, "integrations.afdian.oauth.clientSecret"); }
  }
  const targets = integrations.webhook_targets; if (!targets || typeof targets !== "object" || Array.isArray(targets)) throw new HttpError(400, "CONFIG_INVALID");
  for (const [id, targetValue] of Object.entries(targets)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw new HttpError(400, "CONFIG_INVALID", "Webhook 标识无效");
    const target = object(targetValue, `integrations.webhook_targets.${id}`); exact(target, ["url", "secret", "commands"], `integrations.webhook_targets.${id}`);
    try { if (new URL(plain(target.url, "webhook.url")).protocol !== "https:") throw new Error(); } catch { throw new HttpError(400, "CONFIG_INVALID", "Webhook 地址必须使用 HTTPS"); }
    if (plain(target.secret, "webhook.secret").length < 32) throw new HttpError(400, "CONFIG_INVALID", "Webhook 密钥至少 32 字符");
    if (target.commands !== undefined) { const commands = object(target.commands, "webhook.commands"); for (const [name, permission] of Object.entries(commands)) if (!/^[a-z][a-z0-9_.-]{0,99}$/.test(name) || !["user", "admin"].includes(String(permission))) throw new HttpError(400, "CONFIG_INVALID", "Webhook 命令配置无效"); }
  }
  return value as UnifiedConfigDocument;
}
export function documentFromConfig(base: Config, platform: PlatformConfig): UnifiedConfigDocument {
  return { schema_version: 1, server: { host: base.host, port: base.port, log_level: base.logLevel, trusted_proxy_cidrs: base.trustedProxyCidrs ?? [] },
    database: { database_url: base.databaseUrl, read_database_url: base.readDatabaseUrl, auth_database_url: platform.authDatabaseUrl, queue_database_url: platform.queueDatabaseUrl },
    auth: { origin: platform.origin, secret: platform.secret, require_verification: platform.requireVerification },
    integrations: { github: platform.github ? { client_id: platform.github.clientId, client_secret: platform.github.clientSecret } : null,
      smtp: platform.smtp ? { host: platform.smtp.host, port: platform.smtp.port, secure: platform.smtp.secure, user: platform.smtp.user, password: platform.smtp.password, from: platform.smtp.from } : null,
      storage: platform.storage ? { endpoint: platform.storage.endpoint, region: platform.storage.region, bucket: platform.storage.bucket, key_id: platform.storage.keyId, key_secret: platform.storage.keySecret } : null,
      afdian: platform.afdian ? { ...platform.afdian } : null, webhook_targets: platform.webhookTargets }, };
}
export function redactedDocument(document: UnifiedConfigDocument): UnifiedConfigDocument {
  const copy = JSON.parse(JSON.stringify(document)) as UnifiedConfigDocument;
  maskSecrets(copy);
  return copy;
}
function secretKey(key: string, path: string) { return key === "secret" || key === "password" || key === "token" || key === "key_secret" || key === "client_secret" || key === "clientSecret" || path.startsWith("database.") || path === "auth.secret"; }
function maskSecrets(value: unknown, path = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const current = path ? `${path}.${key}` : key;
    if (secretKey(key, current)) (value as Record<string, unknown>)[key] = "***";
    else maskSecrets(item, current);
  }
}
function restoreSecrets(value: unknown, before: unknown) {
  if (!value || !before || typeof value !== "object" || typeof before !== "object" || Array.isArray(value) || Array.isArray(before)) return;
  const previous = before as Record<string, unknown>;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === "***" && Object.hasOwn(previous, key)) (value as Record<string, unknown>)[key] = previous[key];
    else restoreSecrets(item, previous[key]);
  }
}
function changed(before: unknown, after: unknown, path = ""): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [path || "config"];
  const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]); return [...keys].flatMap((key) => changed((before as any)[key], (after as any)[key], path ? `${path}.${key}` : key));
}
function restartFor(paths: string[]) { return paths.filter((path) => restartPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))); }
export interface ConfigChange { version: number; changed_paths: string[]; restart_required: string[]; applied_hot: string[]; }
export class RuntimeConfig {
  private current: UnifiedConfigDocument;
  private version = 0;
  private appliedVersion = 0;
  private pendingRestart: string[] = [];
  constructor(private pool: Pool, private base: Config, private platform: PlatformConfig) { this.current = documentFromConfig(base, platform); }
  async load() {
    const row = (await this.pool.query("SELECT version,payload_encrypted FROM core.runtime_config WHERE singleton=true")).rows[0];
    if (!row) { this.appliedVersion = 0; return; }
    const document = validateConfigDocument(unseal<unknown>(row.payload_encrypted, this.platform.secret));
    this.current = document; this.version = Number(row.version); this.appliedVersion = this.version; this.applyFull(document);
  }
  getVersion() { return this.version; }
  getAppliedVersion() { return this.appliedVersion; }
  getRestartRequired() { return this.pendingRestart; }
  getDocument(redact = true) { return redact ? redactedDocument(this.current) : this.current; }
  template() { const value = JSON.parse(JSON.stringify(this.getDocument(false))) as UnifiedConfigDocument; clearSecrets(value); return value; }
  async validate(document: unknown) { const next = validateConfigDocument(document); restoreSecrets(next, this.current); const paths = changed(this.current, next); const restartRequired = restartFor(paths); if (this.current.integrations.afdian === null || next.integrations.afdian === null) restartRequired.push("integrations.afdian"); return { valid: true, changed_paths: paths, restart_required: [...new Set(restartRequired)], applied_hot: paths.filter((path) => !restartRequired.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) }; }
  async update(document: unknown, expectedVersion: number | undefined, actor: string, source: string): Promise<ConfigChange> {
    const next = validateConfigDocument(document); const db = await this.pool.connect();
    try {
      await db.query("BEGIN"); await db.query("SELECT pg_advisory_xact_lock(736006)");
      const row = (await db.query("SELECT version,payload_encrypted FROM core.runtime_config WHERE singleton=true FOR UPDATE")).rows[0];
      const actual = row ? Number(row.version) : this.version;
      if (expectedVersion !== undefined && expectedVersion !== actual) throw new HttpError(409, "CONFIG_VERSION_CONFLICT");
      const before = row ? validateConfigDocument(unseal<unknown>(row.payload_encrypted, this.platform.secret)) : this.current;
      restoreSecrets(next, before);
      if (next.auth.secret !== before.auth.secret) throw new HttpError(409, "CONFIG_SECRET_ROTATION_REQUIRES_ENV");
      const changedPaths = changed(before, next); const restartRequired = restartFor(changedPaths); if (before.integrations.afdian === null || next.integrations.afdian === null) restartRequired.push("integrations.afdian"); const uniqueRestart = [...new Set(restartRequired)]; const hot = changedPaths.filter((path) => !uniqueRestart.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)));
      const version = actual + 1; const encrypted = seal(next, this.platform.secret);
      await db.query(`INSERT INTO core.runtime_config(singleton,version,payload_encrypted,updated_by) VALUES(true,$1,$2,$3)
        ON CONFLICT(singleton) DO UPDATE SET version=excluded.version,payload_encrypted=excluded.payload_encrypted,updated_by=excluded.updated_by,updated_at=now()`, [version, encrypted, actor]);
      await db.query("INSERT INTO core.config_audit(version,actor_id,source,changed_paths,restart_required) VALUES($1,$2,$3,$4,$5)", [version, actor, source, changedPaths, uniqueRestart]);
      await db.query("COMMIT"); this.current = next; this.version = version; this.applyHot(next); this.pendingRestart = uniqueRestart.length ? uniqueRestart : this.pendingRestart; if (!this.pendingRestart.length) this.appliedVersion = version;
      return { version, changed_paths: changedPaths, restart_required: uniqueRestart, applied_hot: hot };
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  }
  async sync() {
    const row = (await this.pool.query("SELECT version,payload_encrypted FROM core.runtime_config WHERE singleton=true")).rows[0];
    if (!row || Number(row.version) <= this.version) return false;
    const document = validateConfigDocument(unseal<unknown>(row.payload_encrypted, this.platform.secret));
    const effective = documentFromConfig(this.base, this.platform);
    this.current = document; this.version = Number(row.version); this.applyHot(document);
    const paths = changed(effective, document); const restartRequired = restartFor(paths); if (effective.integrations.afdian === null || document.integrations.afdian === null) restartRequired.push("integrations.afdian");
    this.pendingRestart = [...new Set(restartRequired)];
    if (!this.pendingRestart.length) this.appliedVersion = this.version;
    return true;
  }
  private applyFull(document: UnifiedConfigDocument) {
    this.platform.origin = document.auth.origin; this.platform.requireVerification = document.auth.require_verification;
    this.platform.authDatabaseUrl = document.database.auth_database_url; this.platform.queueDatabaseUrl = document.database.queue_database_url;
    if (document.integrations.github) this.platform.github = { clientId: document.integrations.github.client_id, clientSecret: document.integrations.github.client_secret }; else this.platform.github = undefined;
    if (document.integrations.smtp) this.platform.smtp = { host: document.integrations.smtp.host, port: document.integrations.smtp.port, secure: document.integrations.smtp.secure, user: document.integrations.smtp.user, password: document.integrations.smtp.password, from: document.integrations.smtp.from }; else this.platform.smtp = undefined;
    if (document.integrations.storage) this.platform.storage = { endpoint: document.integrations.storage.endpoint, region: document.integrations.storage.region, bucket: document.integrations.storage.bucket, keyId: document.integrations.storage.key_id, keySecret: document.integrations.storage.key_secret }; else this.platform.storage = undefined;
    if (document.integrations.afdian) this.platform.afdian = { ...document.integrations.afdian };
    this.applyHot(document);
  }
  private applyHot(document: UnifiedConfigDocument) {
    this.platform.webhookTargets = document.integrations.webhook_targets;
    if (document.integrations.afdian && this.platform.afdian) {
      Object.assign(this.platform.afdian, document.integrations.afdian);
    }
  }
}
export function configDigest(document: UnifiedConfigDocument) { return createHash("sha256").update(JSON.stringify(document)).digest("hex"); }
function clearSecrets(value: unknown, path = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) { const current = path ? `${path}.${key}` : key; if (secretKey(key, current)) (value as Record<string, unknown>)[key] = ""; else clearSecrets(item, current); }
}
