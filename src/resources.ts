import type { Pool } from "pg";
import { withReadSnapshot } from "./db/snapshot.js";
import { HttpError } from "./errors.js";

interface Resource {
  id: string; schema_name: string; view_name: string; user_column: string; sort_column: string; columns: string[];
}
const quote = (name: string) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new HttpError(500, "INVALID_RESOURCE_CONFIG");
  return `"${name}"`;
};

export async function readResources(primary: Pool, reader: Pool, userId: string, ids: string[], limit = 20, offset = 0) {
  if (ids.length < 1 || ids.length > 6 || limit < 1 || limit > 100 || offset < 0 || offset > 10000) throw new HttpError(400, "INVALID_QUERY");
  const definitions = await primary.query<Resource>(`SELECT r.* FROM core.resources r JOIN core.services s ON s.id=r.service_id
    WHERE r.id=ANY($1::text[]) AND s.state='active'`, [ids]);
  if (definitions.rowCount !== new Set(ids).size) throw new HttpError(404, "RESOURCE_NOT_FOUND");
  return withReadSnapshot(reader, async (client) => {
    const result: Record<string, unknown> = {};
    for (const resource of definitions.rows) {
      if (!resource.columns.length || !resource.columns.includes(resource.sort_column)) throw new HttpError(500, "INVALID_RESOURCE_CONFIG");
      const query = `SELECT ${resource.columns.map(quote).join(",")} FROM ${quote(resource.schema_name)}.${quote(resource.view_name)}
        WHERE ${quote(resource.user_column)}=$1 ORDER BY ${quote(resource.sort_column)} LIMIT $2 OFFSET $3`;
      result[resource.id] = (await client.query(query, [userId, limit, offset])).rows;
    }
    return { data: result, observed_at: new Date().toISOString(), page: { limit, offset } };
  });
}
