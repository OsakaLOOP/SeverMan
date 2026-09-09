import type { Pool, PoolClient } from "pg";

// 服务端使用已验证的统一身份 ID 查询；传入业务事务可与子站数据保持同一快照。
export async function hasEntitlement(database: Pool | PoolClient, userId: string, entitlement: string): Promise<boolean> {
  const result = await database.query("SELECT 1 FROM core.billing_entitlements_v1 WHERE user_id=$1 AND entitlement_key=$2", [userId, entitlement]);
  return Boolean(result.rowCount);
}
