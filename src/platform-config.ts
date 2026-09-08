export interface PlatformConfig {
  origin: string;
  secret: string;
  authDatabaseUrl: string;
  queueDatabaseUrl: string;
  requireVerification: boolean;
  github?: { clientId: string; clientSecret: string };
  smtp?: { host: string; port: number; secure: boolean; user: string; password: string; from: string };
  storage?: { endpoint: string; region: string; bucket: string; keyId: string; keySecret: string };
  stripe?: { secret: string; webhookSecret: string; prices: string[] };
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
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) config.stripe = { secret: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, prices: (env.STRIPE_PRICE_IDS ?? "").split(",").filter(Boolean) };
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
