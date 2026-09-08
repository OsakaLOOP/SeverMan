import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { provision } from "./provision.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配本地端口");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function startLocalPostgres() {
  const base = resolve(".local");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, "postgres-"));
  const port = await freePort();
  const adminPassword = randomBytes(24).toString("hex");
  const appPassword = randomBytes(24).toString("hex");
  const readPassword = randomBytes(24).toString("hex");
  const logs: string[] = [];
  const capture = (message: unknown) => { logs.push(String(message)); if (logs.length > 20) logs.shift(); };
  const postgres = new EmbeddedPostgres({
    databaseDir: resolve(directory, "data"),
    user: "postgres",
    password: adminPassword,
    port,
    persistent: true,
    authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1", "-c", "shared_buffers=32MB", "-c", "max_connections=20"],
    onLog: capture,
    onError: capture,
  });
  const url = (user: string, password: string) => `postgresql://${user}:${password}@127.0.0.1:${port}/sm`;
  let admin: Pool | undefined;
  try {
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("sm");
    admin = new Pool({ connectionString: url("postgres", adminPassword), max: 2, connectionTimeoutMillis: 5000 });
    await provision(admin, { app: appPassword, reader: readPassword });
  } catch (error) {
    await admin?.end();
    await postgres.stop().catch(() => {});
    throw new Error(`本地 PostgreSQL 初始化失败：${logs.join("\n")}`, { cause: error });
  }
  let closed = false;
  return {
    admin,
    adminUrl: url("postgres", adminPassword),
    directory,
    databaseUrl: url("sm_app", appPassword),
    readDatabaseUrl: url("sm_read", readPassword),
    async close() {
      if (closed) return;
      closed = true;
      await admin.end();
      await postgres.stop();
    },
  };
}
