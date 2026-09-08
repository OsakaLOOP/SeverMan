import { existsSync } from "node:fs";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const config = readConfig();
  const app = buildApp(config);
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10_000).unref();
    try { await app.close(); } finally { clearTimeout(timeout); }
  }
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
}

main().catch(() => {
  console.error("服务启动失败，请检查配置、端口和数据库连接");
  process.exitCode = 1;
});
