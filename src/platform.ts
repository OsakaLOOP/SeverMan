import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { createAuth } from "./auth.js";
import { Jobs } from "./jobs.js";
import type { PlatformConfig } from "./platform-config.js";
import type { DatabaseResources } from "./db/pools.js";
import { HttpError } from "./errors.js";
import { readResources } from "./resources.js";
import { registerStorage } from "./storage.js";
import { registerBilling } from "./billing.js";
import { registerAfdian } from "./afdian-routes.js";
import { RuntimeConfig, documentFromConfig, type UnifiedConfigDocument } from "./runtime-config.js";
import type { Config } from "./config.js";

export interface PlatformOptions {
  config: PlatformConfig;
  baseConfig?: Config;
  worker?: boolean;
  captureMail?: (mail: { to: string; subject: string; text: string }) => void;
  requireAdminTwoFactor?: boolean;
}

export async function registerPlatform(app: FastifyInstance, database: DatabaseResources, options: PlatformOptions) {
  const config = options.config;
  const baseConfig = options.baseConfig ?? { host: "127.0.0.1", port: Number(new URL(config.origin).port || 3000), logLevel: "info", databaseUrl: config.authDatabaseUrl, readDatabaseUrl: config.authDatabaseUrl };
  const runtime = new RuntimeConfig(database.primary, baseConfig, config);
  await runtime.load();
  const authPool = new Pool({ connectionString: config.authDatabaseUrl, max: 3, options: "-c search_path=auth", connectionTimeoutMillis: 1000 });
  authPool.on("error", () => app.log.error("认证数据库连接错误"));
  const jobs = new Jobs(database.primary, database.reader, config, options.captureMail);
  const auth = createAuth(config, authPool, (to, subject, text) => jobs.mail(to, subject, text), async (id) => Boolean((await database.primary.query('SELECT 1 FROM core.admin_account a JOIN auth."user" u ON u.id::text=a.user_id WHERE a.user_id=$1 AND ($2 OR u."twoFactorEnabled"=true)', [id, options.requireAdminTwoFactor === false])).rowCount));
  app.addHook("onClose", async () => { await jobs.stop(); await authPool.end(); });
  await jobs.start(options.worker ?? false);
  const configPoll = setInterval(() => { void runtime.sync().catch(() => app.log.warn("配置热更新同步失败")); }, 2000);
  configPoll.unref();
  app.addHook("onClose", async () => { clearInterval(configPoll); });

  async function session(request: FastifyRequest) {
    const result = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!result) throw new HttpError(401, "AUTH_REQUIRED");
    if (Date.now() - result.session.createdAt.getTime() > 30 * 86400_000) {
      await auth.api.revokeSession({ headers: fromNodeHeaders(request.headers), body: { token: result.session.token } });
      throw new HttpError(401, "SESSION_EXPIRED");
    }
    return result;
  }
  async function user(request: FastifyRequest) { return (await session(request)).user; }
  async function admin(request: FastifyRequest) {
    const current = await user(request);
    if (!(await database.primary.query("SELECT 1 FROM core.admin_account WHERE user_id=$1", [current.id])).rowCount) throw new HttpError(403, "ADMIN_REQUIRED");
    if ((options.requireAdminTwoFactor ?? true) && !current.twoFactorEnabled) throw new HttpError(403, "TWO_FACTOR_REQUIRED");
    return current;
  }
  const audit = async (actor: string, action: string, resource: string) => {
    await database.primary.query("INSERT INTO core.audit_events(actor_id,action,resource_id) VALUES($1,$2,$3)", [actor, action, resource]);
  };
  await app.register(async (api) => {
    api.addHook("onRequest", async (request) => {
      if (!["/v1/billing/webhook", "/v1/billing/afdian/webhook"].includes(request.url.split("?")[0]!) && !["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== config.origin) throw new HttpError(403, "ORIGIN_REJECTED");
    });
    api.get("/v1/me", async (request) => {
      const current = await user(request);
      const isAdmin = Boolean((await database.primary.query("SELECT 1 FROM core.admin_account WHERE user_id=$1", [current.id])).rowCount);
      return { user: current, admin: isAdmin, admin_ready: isAdmin && (options.requireAdminTwoFactor === false || Boolean(current.twoFactorEnabled)) };
    });
    api.get("/v1/config", async () => ({ github: Boolean(config.github), mail: Boolean(config.smtp || options.captureMail), storage: Boolean(config.storage), billing: Boolean(config.afdian || config.stripe), afdian: Boolean(config.afdian), afdian_oauth: Boolean(config.afdian?.oauth), prices: config.stripe?.prices ?? [] }));
    api.get("/v1/admin/config", async (request) => {
      await admin(request);
      return { version: runtime.getVersion(), applied_version: runtime.getAppliedVersion(), restart_required: runtime.getRestartRequired(), document: runtime.getDocument(), template: runtime.template() };
    });
    api.post<{ Body: { document: UnifiedConfigDocument; if_version?: number; source?: string } }>("/v1/admin/config/validate", async (request) => {
      await admin(request);
      return runtime.validate(request.body.document);
    });
    api.put<{ Body: { document: UnifiedConfigDocument; if_version?: number; source?: string } }>("/v1/admin/config", async (request) => {
      const current = await admin(request);
      return runtime.update(request.body.document, request.body.if_version, current.id, request.body.source ?? "panel");
    });
    api.post<{ Body: { document: UnifiedConfigDocument; if_version?: number } }>("/v1/admin/config/upload", async (request) => {
      const current = await admin(request);
      return runtime.update(request.body.document, request.body.if_version, current.id, "upload");
    });
    api.patch<{ Body: { patch: Record<string, unknown>; if_version?: number; source?: string } }>("/v1/admin/config", async (request) => {
      const current = await admin(request);
      const merged = JSON.parse(JSON.stringify(runtime.getDocument(false))) as Record<string, unknown>;
      const merge = (target: Record<string, unknown>, patch: Record<string, unknown>) => { for (const [key, value] of Object.entries(patch)) { if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) merge(target[key] as Record<string, unknown>, value as Record<string, unknown>); else target[key] = value; } };
      merge(merged, request.body.patch);
      return runtime.update(merged, request.body.if_version, current.id, request.body.source ?? "panel");
    });
    api.get("/v1/admin/config/audit", async (request) => { await admin(request); return { items: (await database.primary.query("SELECT version,actor_id,source,changed_paths,restart_required,created_at FROM core.config_audit ORDER BY id DESC LIMIT 100")).rows }; });
    api.get("/v1/admin/config/status", async (request) => { await admin(request); return { version: runtime.getVersion(), applied_version: runtime.getAppliedVersion(), restart_required: runtime.getRestartRequired() }; });
    api.get("/v1/services", async (request) => {
      await user(request);
      return { items: (await database.primary.query("SELECT id,display_name,origin,state,version FROM core.services WHERE state='active' ORDER BY id")).rows };
    });
    api.get("/v1/admin/services", async (request) => { await admin(request); return { items: (await database.primary.query("SELECT * FROM core.services ORDER BY id")).rows }; });
    const serviceBody = {
      type: "object", additionalProperties: false, required: ["id", "display_name", "origin", "redirect_uri"],
      properties: { id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,62}$" }, display_name: { type: "string", minLength: 1, maxLength: 100 }, origin: { type: "string", maxLength: 256 }, redirect_uri: { type: "string", maxLength: 512 } },
    };
    api.post<{ Body: { id: string; display_name: string; origin: string; redirect_uri: string } }>("/v1/admin/services", { schema: { body: serviceBody } }, async (request, reply) => {
      const current = await admin(request);
      const body = request.body;
      let origin: URL; let redirect: URL;
      try { origin = new URL(body.origin); redirect = new URL(body.redirect_uri); } catch { throw new HttpError(400, "INVALID_URL"); }
      const local = ["127.0.0.1", "localhost"].includes(origin.hostname);
      if ((!local && origin.protocol !== "https:") || (local && config.origin.startsWith("https:")) || redirect.origin !== origin.origin || origin.username || origin.password || redirect.hash) throw new HttpError(400, "INVALID_CALLBACK");
      if ((await database.primary.query("SELECT 1 FROM core.services WHERE id=$1", [body.id])).rowCount) throw new HttpError(409, "SERVICE_EXISTS");
      const client = await auth.api.adminCreateOAuthClient({ headers: fromNodeHeaders(request.headers), body: { application_type: local ? "native" : "web", client_name: body.display_name, redirect_uris: [redirect.href], post_logout_redirect_uris: [origin.origin], token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code", "refresh_token"], scope: "openid profile email offline_access", skip_consent: true, require_pkce: true, enable_end_session: true } });
      try {
        await database.primary.query("INSERT INTO core.services(id,display_name,origin,client_id) VALUES($1,$2,$3,$4)", [body.id, body.display_name, origin.origin, client.client_id]);
      } catch (error) {
        await authPool.query('UPDATE "oauthClient" SET disabled=true WHERE "clientId"=$1', [client.client_id]);
        throw error;
      }
      await audit(current.id, "service.create", body.id);
      return reply.code(201).send({ id: body.id, client_id: client.client_id, client_secret: client.client_secret, issuer: `${config.origin}/api/auth` });
    });
    api.patch<{ Params: { id: string }; Body: { state: "active" | "disabled"; version: number } }>("/v1/admin/services/:id", { schema: { body: { type: "object", additionalProperties: false, required: ["state", "version"], properties: { state: { enum: ["active", "disabled"] }, version: { type: "integer", minimum: 1 } } } } }, async (request) => {
      const current = await admin(request);
      const client = await database.primary.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query("UPDATE core.services SET state=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 RETURNING *", [request.params.id, request.body.state, request.body.version]);
        if (!updated.rowCount) throw new HttpError(409, "VERSION_CONFLICT");
        await client.query('UPDATE auth."oauthClient" SET disabled=$2 WHERE "clientId"=$1', [updated.rows[0].client_id, request.body.state === "disabled"]);
        await client.query("COMMIT");
        await audit(current.id, "service.state", request.params.id);
        return updated.rows[0];
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
    api.get("/v1/resources", async (request) => { await user(request); return { items: (await database.primary.query("SELECT r.id,r.service_id,r.columns FROM core.resources r JOIN core.services s ON s.id=r.service_id WHERE s.state='active' ORDER BY r.id")).rows }; });
    api.get("/v1/site-profiles/railround", async (request) => {
      const current = await user(request);
      let snapshot;
      try {
        snapshot = await readResources(database.primary, database.reader, current.id, ["railround_profile"], 1, 0);
      } catch (error) {
        if (error instanceof HttpError && error.code === "RESOURCE_NOT_FOUND") return { profile: null, observed_at: new Date().toISOString(), available: false };
        throw error;
      }
      const rows = snapshot.data.railround_profile as Record<string, unknown>[] | undefined;
      return { profile: rows?.[0] ?? null, observed_at: snapshot.observed_at, available: true };
    });
    api.post<{ Body: { resources: string[]; after_operation_id?: string; limit?: number; offset?: number } }>("/v1/query", { schema: { body: { type: "object", additionalProperties: false, required: ["resources"], properties: { resources: { type: "array", items: { type: "string", maxLength: 100 }, minItems: 1, maxItems: 6, uniqueItems: true }, after_operation_id: { type: "string", format: "uuid" }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0, maximum: 10000 } } } } }, async (request, reply) => {
      const current = await user(request);
      if (request.body.after_operation_id) {
        const operation = await jobs.wait(request.body.after_operation_id, current.id, 2000);
        if (["failed", "cancelled"].includes(operation.status)) throw new HttpError(409, "DEPENDENCY_FAILED");
        if (operation.status !== "succeeded") return reply.code(202).header("retry-after", "1").send(operation);
      }
      return readResources(database.primary, database.reader, current.id, request.body.resources, request.body.limit, request.body.offset);
    });
    api.post<{ Body: { kind: "snapshot" | "webhook" | "command"; resources?: string[]; target?: string; command?: string; data?: object; dependencies?: string[] } }>("/v1/operations", { schema: { body: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { enum: ["snapshot", "webhook", "command"] }, resources: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, uniqueItems: true }, target: { type: "string", maxLength: 100 }, command: { type: "string", maxLength: 100 }, data: { type: "object" }, dependencies: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 10 } } } } }, async (request, reply) => {
      const current = await user(request);
      const { kind, dependencies, ...payload } = request.body;
      if (kind === "webhook") { await admin(request); if (!payload.target || !config.webhookTargets[payload.target]) throw new HttpError(400, "INVALID_TARGET"); }
      if (kind === "command") {
        const permission = config.webhookTargets[payload.target ?? ""]?.commands?.[payload.command ?? ""];
        if (!permission) throw new HttpError(403, "COMMAND_NOT_ALLOWED");
        if (permission === "admin") await admin(request);
      }
      if (kind === "snapshot" && !payload.resources?.length) throw new HttpError(400, "RESOURCES_REQUIRED");
      const operation = await jobs.submit(current.id, kind, payload, String(request.headers["idempotency-key"] ?? ""), dependencies);
      return reply.code(202).header("location", `/v1/operations/${operation.id}`).header("retry-after", "1").send(operation);
    });
    api.get<{ Params: { id: string } }>("/v1/operations/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request) => jobs.get(request.params.id, (await user(request)).id));
    api.get("/v1/operations", async (request) => ({ items: (await database.primary.query("SELECT id,kind,status,attempts,error_code,created_at FROM core.operations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [(await user(request)).id])).rows }));
    api.post<{ Params: { id: string } }>("/v1/operations/:id/cancel", async (request) => {
      const current = await user(request);
      const result = await database.primary.query("UPDATE core.operations SET status='cancelled',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' AND attempts=0 RETURNING id", [request.params.id, current.id]);
      if (!result.rowCount) throw new HttpError(409, "OPERATION_ALREADY_STARTED");
      return { cancelled: true };
    });
    api.get("/v1/admin/status", async (request) => {
      await admin(request);
      return { uptime_seconds: Math.round(process.uptime()), memory: process.memoryUsage(), connections: { active: database.primary.totalCount - database.primary.idleCount, waiting: database.primary.waitingCount }, operations: (await database.primary.query("SELECT status,count(*)::int AS count FROM core.operations GROUP BY status")).rows, integrations: { mail: Boolean(config.smtp || options.captureMail), storage: Boolean(config.storage), billing: Boolean(config.afdian || config.stripe) } };
    });
    api.get("/v1/admin/audit", async (request) => { await admin(request); return { items: (await database.primary.query("SELECT * FROM core.audit_events ORDER BY id DESC LIMIT 100")).rows }; });
    api.post("/v1/sign-out-all", async (request) => {
      const current = await user(request);
      await authPool.query('DELETE FROM "oauthRefreshToken" WHERE "userId"=$1', [current.id]);
      await auth.api.revokeSessions({ headers: fromNodeHeaders(request.headers) });
      return { success: true };
    });
    registerStorage(api, config, database.primary, user);
    registerBilling(api, config, database.primary, user, jobs.afdian);
    if (jobs.afdian) registerAfdian(api, jobs.afdian, database.primary, user, admin);
  });

  await app.register(async (routes) => {
    routes.removeAllContentTypeParsers();
    routes.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    routes.route({ method: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], url: "/api/auth/*", handler: async (request, reply) => {
      const url = new URL(request.url, config.origin);
      if (/\/(?:admin\/|oauth2\/(?:create-client|update-client|delete-client|rotate-client-secret|register))/.test(url.pathname)) throw new HttpError(403, "MANAGED_CLIENTS_ONLY");
      const headers = fromNodeHeaders(request.headers);
      headers.delete("host");
      headers.set("x-real-ip", request.ip);
      const response = await auth.handler(new Request(url, { method: request.method, headers, ...(request.method === "GET" || !request.body ? {} : { body: Uint8Array.from(request.body as Buffer) }) }));
      reply.code(response.status);
      response.headers.forEach((value, key) => { if (key !== "set-cookie") reply.header(key, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(Buffer.from(await response.arrayBuffer()));
    } });
    routes.get("/.well-known/openid-configuration", async (_request, reply) => {
      const response = await auth.handler(new Request(`${config.origin}/api/auth/.well-known/openid-configuration`));
      return reply.code(response.status).type("application/json").send(await response.text());
    });
  });
  return { auth, jobs, authPool };
}
