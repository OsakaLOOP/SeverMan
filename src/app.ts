import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { Config } from "./config.js";
import { createDatabase } from "./db/pools.js";
import { registerPlatform, type PlatformOptions } from "./platform.js";
import { HttpError } from "./errors.js";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function buildApp(config: Config, platform?: PlatformOptions) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
      serializers: { req: (request) => ({ method: request.method, url: request.url?.split("?")[0], id: request.id }) },
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: config.trustedProxyCidrs ?? false,
    bodyLimit: 256 * 1024,
    requestTimeout: 5000,
    connectionTimeout: 10_000,
    keepAliveTimeout: 5000,
    forceCloseConnections: "idle",
  });
  const database = createDatabase(config);
  const poolError = () => app.log.error("数据库闲置连接出现错误");
  database.primary.on("error", poolError);
  database.reader.on("error", poolError);
  app.addHook("onClose", async () => { await database.close(); });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("cache-control", "no-store");
  });
  app.setErrorHandler((error, request, reply) => {
    const candidate = error instanceof Error && "statusCode" in error ? error.statusCode : undefined;
    const status = error instanceof HttpError ? error.statusCode : typeof candidate === "number" && candidate >= 400 && candidate < 500 ? candidate : 500;
    if (status === 500) request.log.error("请求处理失败");
    return reply.code(status).send({ error: { code: error instanceof HttpError ? error.code : status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST", request_id: request.id } });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", request_id: request.id } }));

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (request, reply) => {
    const checks = await Promise.allSettled([
      database.sql.selectFrom("core.services").select("id").limit(0).execute(),
      database.reader.query("SELECT 1"),
    ]);
    if (checks.some((check) => check.status === "rejected")) {
      request.log.warn("数据库或迁移尚未就绪");
      return reply.code(503).send({ status: "unavailable" });
    }
    return { status: "ready" };
  });
  if (platform) {
    app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
    app.register(async (scope) => { await registerPlatform(scope, database, { ...platform, baseConfig: config }); });
    const root = resolve("web/dist");
    if (existsSync(root)) {
      app.register(serveStatic, { root, prefix: "/" });
      for (const url of ["/", "/sign-in", "/sign-up", "/consent", "/reset-password", "/verify-result"]) app.get(url, (_request, reply) => reply.type("text/html").sendFile("index.html"));
    }
  }
  return app;
}
