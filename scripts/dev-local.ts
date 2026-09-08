import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import { startLocalPostgres } from "./local-postgres.js";

const database = await startLocalPostgres();
const app = buildApp({
  host: "127.0.0.1",
  port: 3000,
  logLevel: "info",
  databaseUrl: database.databaseUrl,
  readDatabaseUrl: database.readDatabaseUrl,
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  await database.close();
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
try {
  await migrate(database.admin);
  let port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65525) throw new Error("本地端口须介于 1 和 65525");
  for (let attempt = 0; ; attempt++, port++) {
    try {
      await app.listen({ host: "127.0.0.1", port });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt >= 9) throw error;
    }
  }
  console.log(`本地服务：http://127.0.0.1:${port}/health/ready`);
  console.log("本次使用独立开发数据库，退出时停止；下次启动创建新数据库。");
} catch (error) {
  await stop();
  throw error;
}
