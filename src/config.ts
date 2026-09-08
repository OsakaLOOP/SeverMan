export interface Config {
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  readDatabaseUrl: string;
  trustedProxyCidrs?: string[];
}

function databaseUrl(value: string | undefined, key: string): string {
  if (!value) throw new Error(`缺少配置 ${key}`);
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) {
      throw new Error();
    }
  } catch {
    throw new Error(`${key} 必须是有效的 PostgreSQL 连接地址`);
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 必须介于 1 和 65535");
  const logLevel = env.LOG_LEVEL ?? "info";
  if (!["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(logLevel)) throw new Error("LOG_LEVEL 无效");
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    logLevel,
    databaseUrl: databaseUrl(env.DATABASE_URL, "DATABASE_URL"),
    readDatabaseUrl: databaseUrl(env.READ_DATABASE_URL, "READ_DATABASE_URL"),
    trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS?.split(",").map((value) => value.trim()).filter(Boolean),
  };
}
