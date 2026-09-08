import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Pool } from "pg";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlatformConfig } from "./platform-config.js";
import { HttpError } from "./errors.js";

export function registerStorage(app: FastifyInstance, config: PlatformConfig, pool: Pool, user: (request: FastifyRequest) => Promise<{ id: string }>) {
  const storage = config.storage;
  const client = storage ? new S3Client({ endpoint: storage.endpoint, region: storage.region, forcePathStyle: true, credentials: { accessKeyId: storage.keyId, secretAccessKey: storage.keySecret }, maxAttempts: 2 }) : undefined;
  app.addHook("onClose", async () => { client?.destroy(); });
  app.post<{ Body: { content_type: string; size: number } }>("/v1/uploads", { schema: { body: { type: "object", additionalProperties: false, required: ["content_type", "size"], properties: { content_type: { enum: ["image/jpeg", "image/png", "image/webp", "image/avif"] }, size: { type: "integer", minimum: 1, maximum: 10485760 } } } } }, async (request, reply) => {
    const current = await user(request);
    if (!client || !storage) throw new HttpError(503, "STORAGE_UNAVAILABLE");
    const count = await pool.query("SELECT count(*)::int AS count FROM core.uploads WHERE user_id=$1 AND created_at > now()-interval '1 hour'", [current.id]);
    if (count.rows[0].count >= 50) throw new HttpError(429, "UPLOAD_LIMIT");
    const id = randomUUID();
    const key = `users/${current.id}/${id}`;
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: storage.bucket, Key: key, ContentType: request.body.content_type, ContentLength: request.body.size }), { expiresIn: 300 });
    await pool.query("INSERT INTO core.uploads(id,user_id,object_key,content_type,expected_size) VALUES($1,$2,$3,$4,$5)", [id, current.id, key, request.body.content_type, request.body.size]);
    return reply.code(201).send({ id, url, method: "PUT", headers: { "content-type": request.body.content_type }, expires_in: 300 });
  });
  app.post<{ Params: { id: string } }>("/v1/uploads/:id/confirm", { schema: { params: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } } }, async (request) => {
    const current = await user(request);
    if (!client || !storage) throw new HttpError(503, "STORAGE_UNAVAILABLE");
    const row = (await pool.query("SELECT * FROM core.uploads WHERE id=$1 AND user_id=$2", [request.params.id, current.id])).rows[0];
    if (!row) throw new HttpError(404, "UPLOAD_NOT_FOUND");
    const object = await client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: row.object_key }), { abortSignal: AbortSignal.timeout(5000) });
    if (object.ContentLength !== Number(row.expected_size) || object.ContentType !== row.content_type) throw new HttpError(409, "UPLOAD_MISMATCH");
    await pool.query("UPDATE core.uploads SET status='ready' WHERE id=$1", [row.id]);
    return { id: row.id, object_key: row.object_key, status: "ready" };
  });
}
