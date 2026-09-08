import Fastify from "fastify";
import { Pool } from "pg";
import { registerBff } from "../../sdk/bff.js";
import { registerCommands } from "../../sdk/commands.js";
if (process.getBuiltinModule("fs").existsSync(".env")) process.loadEnvFile(".env");
const pool = new Pool({ connectionString: process.env.SITE_DATABASE_URL, max: 2 });
const app = Fastify({ logger: true });
const origin = process.env.SITE_ORIGIN ?? "http://127.0.0.1:4100";
const bff = await registerBff(app, { issuer: process.env.SITE_ISSUER!, clientId: process.env.SITE_CLIENT_ID!, clientSecret: process.env.SITE_CLIENT_SECRET!, secret: process.env.SITE_SESSION_SECRET!, origin, pool, schema: "site_example" });
if (process.env.SITE_COMMAND_SECRET) await registerCommands(app, { schema: "site_example", secret: process.env.SITE_COMMAND_SECRET, pool, handlers: {
  "notes.create": async (transaction, userId, data) => {
    if (typeof data.title !== "string" || !data.title || data.title.length > 200) throw new Error("标题须为 1 至 200 字符");
    return (await transaction.query("INSERT INTO site_example.notes(user_id,title) VALUES($1,$2) RETURNING id,version", [userId, data.title])).rows[0];
  },
} });
app.addHook("onClose", async () => pool.end());
await app.register(async (api) => {
  api.addHook("onRequest", async (request, reply) => {
    if (!["GET", "HEAD"].includes(request.method) && request.headers.origin !== origin) return reply.code(403).send({ error: "ORIGIN_REJECTED" });
  });
  api.get<{ Querystring: { after?: string; limit?: number } }>("/api/notes", { schema: { querystring: { type: "object", properties: { after: { type: "string", format: "uuid" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } } } }, async (request, reply) => {
    const current = await bff.getUser(request); if (!current) return reply.code(401).send();
    const result = await pool.query("SELECT * FROM site_example.notes WHERE user_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3", [current.id, request.query.after ?? null, Number(request.query.limit ?? 20) + 1]);
    const more = result.rows.length > Number(request.query.limit ?? 20); if (more) result.rows.pop();
    return { items: result.rows, next_cursor: more ? result.rows.at(-1)?.id : null };
  });
  api.post<{ Body: { title: string } }>("/api/notes", { schema: { body: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 200 } } } } }, async (request, reply) => {
    const current = await bff.getUser(request); if (!current) return reply.code(401).send();
    return reply.code(201).send((await pool.query("INSERT INTO site_example.notes(user_id,title) VALUES($1,$2) RETURNING *", [current.id, request.body.title])).rows[0]);
  });
  api.patch<{ Params: { id: string }; Body: { title: string; version: number } }>("/api/notes/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", required: ["title", "version"], additionalProperties: false, properties: { title: { type: "string", minLength: 1, maxLength: 200 }, version: { type: "integer", minimum: 1 } } } } }, async (request, reply) => {
    const current = await bff.getUser(request); if (!current) return reply.code(401).send();
    const result = await pool.query("UPDATE site_example.notes SET title=$3,version=version+1 WHERE id=$1 AND user_id=$2 AND version=$4 RETURNING *", [request.params.id, current.id, request.body.title, request.body.version]);
    return result.rowCount ? result.rows[0] : reply.code(409).send({ error: "VERSION_CONFLICT" });
  });
  api.delete<{ Params: { id: string } }>("/api/notes/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
    const current = await bff.getUser(request); if (!current) return reply.code(401).send();
    const result = await pool.query("DELETE FROM site_example.notes WHERE id=$1 AND user_id=$2", [request.params.id, current.id]);
    return reply.code(result.rowCount ? 204 : 404).send();
  });
});
await app.listen({ host: "127.0.0.1", port: Number(new URL(origin).port || 4100) });
process.once("SIGINT", () => { void app.close(); });
process.once("SIGTERM", () => { void app.close(); });
