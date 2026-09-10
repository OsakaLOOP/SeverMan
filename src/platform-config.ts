import { createPublicKey } from "node:crypto";
import { AFDIAN_PUBLIC_KEY, type AfdianConfig } from "./afdian-client.js";

export interface PlatformConfig {
  origin: string;
  secret: string;
  authDatabaseUrl: string;
  queueDatabaseUrl: string;
  requireVerification: boolean;
  github?: { clientId: string; clientSecret: string };
  smtp?: { host: string; port: number; secure: boolean; user: string; password: string; from: string };
  storage?: { endpoint: string; region: string; bucket: string; keyId: string; keySecret: string };
  afdian?: AfdianConfig;
  webhookTargets: Record<string, { url: string; secret: string; commands?: Record<string, "user" | "admin"> }>;
}

export function readPlatformConfig(env = process.env): PlatformConfig {
  const origin = new URL(env.AUTH_ORIGIN ?? "http://127.0.0.1:3000").origin;
  const secret = env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET 至少 32 字符");
  if (env.NODE_ENV === "production" && !origin.startsWith("https://")) throw new Error("生产 AUTH_ORIGIN 必须使用 HTTPS");
  if (!env.AUTH_DATABASE_URL || !env.QUEUE_DATABASE_URL) throw new Error("缺少认证或任务数据库连接");
  const config: PlatformConfig = {
    origin, secret, authDatabaseUrl: env.AUTH_DATABASE_URL, queueDatabaseUrl: env.QUEUE_DATABASE_URL,
    requireVerification: true,
    webhookTargets: {},
  };
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) config.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  if (env.SMTP_HOST && env.SMTP_FROM) config.smtp = { host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === "true", user: env.SMTP_USER ?? "", password: env.SMTP_PASSWORD ?? "", from: env.SMTP_FROM };
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) config.storage = { endpoint: env.S3_ENDPOINT, region: env.S3_REGION ?? "auto", bucket: env.S3_BUCKET, keyId: env.S3_ACCESS_KEY_ID, keySecret: env.S3_SECRET_ACCESS_KEY };
  if (env.AFDIAN_USER_ID || env.AFDIAN_TOKEN || env.AFDIAN_PLANS_JSON) {
    if (!/^[a-f0-9]{32}$/.test(env.AFDIAN_USER_ID ?? "") || !env.AFDIAN_TOKEN) throw new Error("请完整配置爱发电商户 ID 和 API Token");
    const plans = JSON.parse(env.AFDIAN_PLANS_JSON || "[]") as AfdianConfig["plans"];
    if (!Array.isArray(plans) || plans.length > 30 || plans.some((p) => !p || !/^[a-z][a-z0-9_-]{0,49}$/.test(p.id)
      || !/^[a-f0-9]{32}$/.test(p.planId) || typeof p.permanent !== "boolean" || typeof p.enabled !== "boolean"
      || !Array.isArray(p.entitlements) || !p.entitlements.length || p.entitlements.length > 30
      || p.entitlements.some((key) => typeof key !== "string" || !/^[a-z][a-z0-9_.:-]{0,99}$/.test(key)))
      || new Set(plans.map((p) => p.id)).size !== plans.length || new Set(plans.map((p) => p.planId)).size !== plans.length) throw new Error("AFDIAN_PLANS_JSON 套餐规则无效");
    const publicKey = env.AFDIAN_WEBHOOK_PUBLIC_KEY?.replaceAll("\\n", "\n") || AFDIAN_PUBLIC_KEY;
    if (createPublicKey(publicKey).asymmetricKeyType !== "rsa") throw new Error("爱发电 Webhook 公钥必须为 RSA");
    config.afdian = { userId: env.AFDIAN_USER_ID!, token: env.AFDIAN_TOKEN, publicKey, plans };
    if (env.AFDIAN_OAUTH_CLIENT_ID || env.AFDIAN_OAUTH_CLIENT_SECRET) {
      if (!env.AFDIAN_OAUTH_CLIENT_ID || !env.AFDIAN_OAUTH_CLIENT_SECRET) throw new Error("请完整配置爱发电 OAuth2 凭据");
      config.afdian.oauth = { clientId: env.AFDIAN_OAUTH_CLIENT_ID, clientSecret: env.AFDIAN_OAUTH_CLIENT_SECRET };
    }
  }
  if (env.WEBHOOK_TARGETS_JSON) {
    const parsed = JSON.parse(env.WEBHOOK_TARGETS_JSON) as PlatformConfig["webhookTargets"];
    for (const [id, target] of Object.entries(parsed)) {
      if (!/^[a-z][a-z0-9_-]*$/.test(id) || new URL(target.url).protocol !== "https:" || target.secret.length < 32) throw new Error("Webhook 目标配置无效");
      if (target.commands && !Object.entries(target.commands).every(([name, permission]) => /^[a-z][a-z0-9_.-]{0,99}$/.test(name) && ["user", "admin"].includes(permission))) throw new Error("服务命令配置无效");
    }
    config.webhookTargets = parsed;
  }
  return config;
}
