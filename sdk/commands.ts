import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { verifyWebhook } from "../src/security.js";

export type CommandHandler = (transaction: PoolClient, userId: string, data: Record<string, unknown>) => Promise<unknown>;

export async function registerCommands(app: FastifyInstance, options: { schema: string; secret: string; pool: Pool; handlers: Record<string, CommandHandler> }) {
  if (!/^site_[a-z0-9_]+$/.test(options.schema) || options.secret.length < 32) throw new Error("命令服务配置无效");
  const table = `"${options.schema}".command_results`;
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => done(null, body));
    scope.post("/internal/commands", { bodyLimit: 256 * 1024 }, async (request, reply) => {
      const body = request.body as string;
      const id = String(request.headers["x-event-id"] ?? "");
      if (!/^[0-9a-f-]{36}$/.test(id) || !verifyWebhook(body, id, Number(request.headers["x-timestamp"]), String(request.headers["x-signature"] ?? ""), options.secret)) return reply.code(401).send({ error: "INVALID_SIGNATURE" });
      let input: { id: string; user_id: string; command: string; data: Record<string, unknown> };
      try { input = JSON.parse(body); } catch { return reply.code(400).send({ error: "INVALID_COMMAND" }); }
      const handler = Object.hasOwn(options.handlers, input.command) ? options.handlers[input.command] : undefined;
      if (input.id !== id || typeof input.user_id !== "string" || !input.user_id || !handler || !input.data || Array.isArray(input.data) || typeof input.data !== "object") return reply.code(400).send({ error: "INVALID_COMMAND" });
      const digest = createHash("sha256").update(body).digest("hex");
      const transaction = await options.pool.connect();
      try {
        await transaction.query("BEGIN");
        await transaction.query("SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
        // 插入竞争等待已有事务结束；业务结果与业务写入原子提交。
        const inserted = await transaction.query(`INSERT INTO ${table}(id,request_digest) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id`, [id, digest]);
        if (!inserted.rowCount) {
          const existing = (await transaction.query(`SELECT request_digest,result FROM ${table} WHERE id=$1`, [id])).rows[0];
          await transaction.query("COMMIT");
          if (existing.request_digest !== digest) return reply.code(409).send({ error: "IDEMPOTENCY_CONFLICT" });
          return existing.result;
        }
        const result = { operation_id: id, status: "succeeded", result: await handler(transaction, input.user_id, input.data) };
        if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw new Error("命令结果超过 64 KB");
        await transaction.query(`UPDATE ${table} SET result=$2 WHERE id=$1`, [id, JSON.stringify(result)]);
        await transaction.query("COMMIT");
        return result;
      } catch (error) { await transaction.query("ROLLBACK"); throw error; } finally { transaction.release(); }
    });
  });
}
