import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import nodemailer from "nodemailer";
import type { PlatformConfig } from "./platform-config.js";
import { HttpError } from "./errors.js";
import { seal, signWebhook, unseal } from "./security.js";
import { readResources } from "./resources.js";

export interface Operation {
  id: string; user_id: string; kind: "snapshot" | "mail" | "webhook" | "command";
  status: string; payload: Record<string, unknown>; result: unknown; error_code: string | null;
  attempts: number; request_digest: string;
}

export class Jobs {
  readonly boss: PgBoss;
  private transport;
  private recovery?: ReturnType<typeof setInterval>;
  constructor(private primary: Pool, private reader: Pool, private config: PlatformConfig, private captureMail?: (mail: { to: string; subject: string; text: string }) => void) {
    this.boss = new PgBoss({ connectionString: config.queueDatabaseUrl, schema: "jobs", max: 2, migrate: false, supervise: true });
    this.boss.on("error", () => console.error("任务队列连接错误"));
    this.transport = config.smtp ? nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password }, pool: true, maxConnections: 1,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10_000, maxRequeues: 0,
    }) : undefined;
  }
  async start(worker: boolean) {
    await this.boss.start();
    await this.boss.createQueue("platform", { retryLimit: 5, retryDelay: 1, retryBackoff: true, expireInSeconds: 30 });
    if (worker) {
      await this.recover();
      this.recovery = setInterval(() => { void this.recover().catch(() => console.error("任务恢复检查失败")); }, 15_000);
      this.recovery.unref();
      await this.boss.work<{ id: string }>("platform", { localConcurrency: 2, pollingIntervalSeconds: 0.5 }, async ([job]) => {
        if (job) await this.execute(job.data.id);
      });
    }
  }
  async stop() { clearInterval(this.recovery); await this.boss.stop({ graceful: true, timeout: 10_000 }); this.transport?.close(); }

  async recover() {
    const client = await this.primary.connect();
    try {
      await client.query("BEGIN");
      // 数据库操作记录负责恢复；队列消息与状态更新共用事务。
      const stale = await client.query<Operation>(`SELECT * FROM core.operations WHERE
        (status='pending' AND updated_at<now()-interval '60 seconds') OR
        (status='running' AND lease_until<now()) ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`);
      for (const operation of stale.rows) {
        if (operation.attempts >= 6) {
          await client.query("UPDATE core.operations SET status='failed',error_code='RETRY_EXHAUSTED',lease_until=NULL,updated_at=now() WHERE id=$1", [operation.id]);
        } else {
          await client.query("UPDATE core.operations SET status='pending',lease_until=NULL,updated_at=now() WHERE id=$1", [operation.id]);
          await this.boss.send("platform", { id: operation.id }, { db: { executeSql: (sql, values) => client.query(sql, values) } });
        }
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async submit(userId: string, kind: Operation["kind"], payload: Record<string, unknown>, key: string, dependencies: string[] = []) {
    if (!key || key.length > 128 || dependencies.length > 10) throw new HttpError(400, "INVALID_OPERATION");
    const digest = createHash("sha256").update(JSON.stringify({ kind, payload, dependencies: [...dependencies].sort() })).digest("hex");
    const client = await this.primary.connect();
    try {
      await client.query("BEGIN");
      if (dependencies.length) {
        const allowed = await client.query("SELECT id FROM core.operations WHERE user_id=$1 AND id=ANY($2::uuid[])", [userId, dependencies]);
        if (allowed.rowCount !== new Set(dependencies).size) throw new HttpError(404, "DEPENDENCY_NOT_FOUND");
      }
      const id = randomUUID();
      const stored = kind === "mail" ? { encrypted: seal(payload, this.config.secret) } : payload;
      const inserted = await client.query<Operation>(`INSERT INTO core.operations(id,user_id,kind,idempotency_key,request_digest,payload)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING *`, [id, userId, kind, key, digest, stored]);
      let operation = inserted.rows[0];
      if (!operation) {
        operation = (await client.query<Operation>("SELECT * FROM core.operations WHERE user_id=$1 AND idempotency_key=$2", [userId, key])).rows[0]!;
        if (operation.request_digest !== digest) throw new HttpError(409, "IDEMPOTENCY_CONFLICT");
      } else {
        for (const dependency of dependencies) await client.query("INSERT INTO core.operation_dependencies VALUES($1,$2)", [id, dependency]);
        await this.boss.send("platform", { id }, { db: { executeSql: (sql, values) => client.query(sql, values) }, priority: kind === "mail" ? 10 : 0 });
      }
      await client.query("COMMIT");
      return this.publicOperation(operation);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  publicOperation(operation: Operation) {
    return { id: operation.id, kind: operation.kind, status: operation.status, result: operation.result, error_code: operation.error_code, attempts: operation.attempts };
  }
  async get(id: string, userId: string) {
    const operation = (await this.primary.query<Operation>("SELECT * FROM core.operations WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    if (!operation) throw new HttpError(404, "OPERATION_NOT_FOUND");
    return this.publicOperation(operation);
  }
  async wait(id: string, userId: string, milliseconds: number) {
    const end = Date.now() + Math.min(2000, Math.max(0, milliseconds));
    for (;;) {
      const operation = await this.get(id, userId);
      if (["succeeded", "failed", "cancelled"].includes(operation.status) || Date.now() >= end) return operation;
      await delay(100);
    }
  }
  async mail(to: string, subject: string, text: string) {
    if (!this.transport && !this.captureMail) throw new HttpError(503, "MAIL_UNAVAILABLE");
    await this.submit("system-mail", "mail", { to, subject, text }, randomUUID());
  }
  private async execute(id: string) {
    const operation = (await this.primary.query<Operation>("SELECT * FROM core.operations WHERE id=$1", [id])).rows[0];
    if (!operation || ["succeeded", "failed", "cancelled"].includes(operation.status)) return;
    const expired = await this.primary.query("UPDATE core.operations SET status='failed',error_code='DEADLINE_EXCEEDED' WHERE id=$1 AND created_at < now()-interval '15 minutes' RETURNING id", [id]);
    if (expired.rowCount) return;
    const dependencies = await this.primary.query<{ status: string }>(`SELECT o.status FROM core.operation_dependencies d JOIN core.operations o ON o.id=d.dependency_id WHERE d.operation_id=$1`, [id]);
    if (dependencies.rows.some((row) => ["failed", "cancelled"].includes(row.status))) {
      await this.primary.query("UPDATE core.operations SET status='failed',error_code='DEPENDENCY_FAILED',updated_at=now() WHERE id=$1", [id]);
      return;
    }
    if (dependencies.rows.some((row) => row.status !== "succeeded")) {
      await this.boss.send("platform", { id }, { startAfter: 1 });
      return;
    }
    const claimed = await this.primary.query("UPDATE core.operations SET status='running',attempts=attempts+1,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1 AND status IN ('pending','running') AND (lease_until IS NULL OR lease_until < now()) RETURNING attempts", [id]);
    if (!claimed.rowCount) return;
    try {
      let result: unknown = { delivered: true };
      if (operation.kind === "snapshot") {
        result = await readResources(this.primary, this.reader, operation.user_id, operation.payload.resources as string[], Number(operation.payload.limit ?? 20));
      } else if (operation.kind === "mail") {
        const mail = unseal<{ to: string; subject: string; text: string }>(String(operation.payload.encrypted), this.config.secret);
        if (this.captureMail) this.captureMail(mail);
        else if (this.transport && this.config.smtp) await this.transport.sendMail({ ...mail, from: this.config.smtp.from, messageId: `<${id}@${new URL(this.config.origin).hostname}>` });
        else throw new Error("MAIL_UNAVAILABLE");
      } else {
        const target = this.config.webhookTargets[String(operation.payload.target)];
        if (!target) throw new Error("WEBHOOK_TARGET_UNAVAILABLE");
        const command = operation.kind === "command";
        if (command && !target.commands?.[String(operation.payload.command)]) throw new HttpError(403, "COMMAND_NOT_ALLOWED");
        const body = JSON.stringify({ id, data: operation.payload.data, ...(command ? { user_id: operation.user_id, command: operation.payload.command } : {}) });
        const timestamp = Math.floor(Date.now() / 1000);
        const response = await fetch(target.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json", "x-event-id": id, "x-timestamp": String(timestamp), "x-signature": signWebhook(body, id, timestamp, target.secret) }, body });
        if (!response.ok) { await response.body?.cancel(); throw new Error("REMOTE_EXECUTION_FAILED"); }
        if (command) {
          const reader = response.body?.getReader();
          let text = ""; let bytes = 0;
          if (!reader) throw new Error("COMMAND_RESULT_MISSING");
          const decoder = new TextDecoder();
          try {
            for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 65536) throw new Error("COMMAND_RESULT_TOO_LARGE"); text += decoder.decode(chunk.value, { stream: true }); }
          } finally { await reader.cancel(); }
          const completion = JSON.parse(text + decoder.decode());
          if (completion.operation_id !== id || completion.status !== "succeeded") throw new Error("COMMAND_NOT_COMMITTED");
          result = completion.result;
        } else await response.body?.cancel();
      }
      await this.primary.query("UPDATE core.operations SET status='succeeded',result=$2,error_code=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND attempts=$3 AND status='running' AND lease_until>now()", [id, JSON.stringify(result), claimed.rows[0].attempts]);
    } catch (error) {
      const terminal = claimed.rows[0].attempts >= 6 || (error instanceof HttpError && error.statusCode < 500);
      await this.primary.query("UPDATE core.operations SET status=$2,error_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND attempts=$4 AND status='running' AND lease_until>now()", [id, terminal ? "failed" : "pending", error instanceof HttpError ? error.code : "EXECUTION_FAILED", claimed.rows[0].attempts]);
      throw error;
    }
  }
}
