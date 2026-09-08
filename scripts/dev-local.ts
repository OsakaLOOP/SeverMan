import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import { startLocalPostgres } from "./local-postgres.js";
import { migrateQueue } from "./queue-migrate.js";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const database = await startLocalPostgres();
const port = Number(process.env.PORT ?? "3001");
const origin = `http://127.0.0.1:${port}`;
const outbox: { to: string; subject: string; text: string }[] = [];
const secret = randomBytes(32).toString("hex");
const app = buildApp({
  host: "127.0.0.1",
  port,
  logLevel: "info",
  databaseUrl: database.databaseUrl,
  readDatabaseUrl: database.readDatabaseUrl,
}, { config: { origin, secret, authDatabaseUrl: database.databaseUrl, queueDatabaseUrl: database.databaseUrl, requireVerification: true, webhookTargets: {} }, worker: true, requireAdminTwoFactor: false, captureMail: (mail) => outbox.push(mail) });
app.get("/_dev/mail", async () => outbox);
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
  await migrateQueue(database.adminUrl);
  if (!Number.isInteger(port) || port < 1 || port > 65525) throw new Error("本地端口须介于 1 和 65525");
  await app.listen({ host: "127.0.0.1", port });
  if (process.env.SM_DEMO === "1") {
    const password = randomBytes(18).toString("base64url");
    const email = "demo@example.test";
    const registered = await app.inject({ method: "POST", url: "/api/auth/sign-up/email", headers: { origin }, payload: { email, password, name: "本地开发" } });
    const id = registered.json().user.id;
    await database.admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [id]);
    await database.admin.query("INSERT INTO core.admin_account(user_id) VALUES($1)", [id]);
    const login = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin }, payload: { email, password } });
    const cookie = login.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
    for (const [service, displayName] of [["notes", "个人笔记"], ["reading", "阅读与收藏"], ["status", "服务状态"]]) {
      await app.inject({ method: "POST", url: "/v1/admin/services", headers: { origin, cookie }, payload: { id: service, display_name: displayName, origin: `https://${service}.example.test`, redirect_uri: `https://${service}.example.test/auth/callback` } });
    }
    await writeFile(".local/dev-account.json", JSON.stringify({ email, password, origin }), "utf8");
  }
  console.log(`本地服务：${origin}`);
  console.log("本次使用独立开发数据库，退出时停止；下次启动创建新数据库。");
} catch (error) {
  await stop();
  throw error;
}
