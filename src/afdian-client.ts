import { createHash, createPublicKey, verify } from "node:crypto";
import { HttpError } from "./errors.js";
import { setTimeout as delay } from "node:timers/promises";

export const AFDIAN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`;

export interface AfdianPlanRule {
  id: string;
  planId: string;
  entitlements: string[];
  permanent: boolean;
  enabled: boolean;
}
export interface AfdianConfig {
  userId: string;
  token: string;
  publicKey: string;
  plans: AfdianPlanRule[];
  oauth?: { clientId: string; clientSecret: string };
}
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
  return value as JsonObject;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
  return value;
}
export function amountCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(value)) throw new HttpError(502, "AFDIAN_INVALID_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function signedRequest(userId: string, token: string, params: JsonObject, ts = Math.floor(Date.now() / 1000)) {
  const encoded = JSON.stringify(params);
  const sign = createHash("md5").update(`${token}params${encoded}ts${ts}user_id${userId}`).digest("hex");
  return { user_id: userId, params: encoded, ts, sign };
}
export function verifyAfdianWebhook(payload: unknown, publicKey: string): JsonObject {
  try {
    const data = object(object(payload).data);
    const order = object(data.order);
    if (data.type !== "order" || typeof data.sign !== "string" || data.sign.length > 1024) throw new Error();
    const message = [identifier(order.out_trade_no), identifier(order.user_id), String(order.plan_id ?? ""), String(order.total_amount)].join("");
    amountCents(order.total_amount);
    if (!verify("RSA-SHA256", Buffer.from(message), createPublicKey(publicKey), Buffer.from(data.sign, "base64"))) throw new Error();
    return order;
  } catch { throw new HttpError(401, "AFDIAN_INVALID_SIGNATURE"); }
}

export class AfdianClient {
  private lastRequest = 0;
  constructor(private config: AfdianConfig, private transport: typeof fetch = fetch) {}
  private async request(path: string, body: string, form = false): Promise<JsonObject> {
    try {
      await delay(Math.max(0, 250 - (Date.now() - this.lastRequest)));
      this.lastRequest = Date.now();
      const response = await this.transport(`https://ifdian.net${path}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" }, body,
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2 * 1024 * 1024) throw new Error();
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      const result = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (result.ec !== 200) throw new Error();
      return object(result.data);
    } catch { throw new HttpError(502, "AFDIAN_API_UNAVAILABLE"); }
  }
  call(method: "query-order" | "query-sponsor" | "query-plan", params: JsonObject) {
    return this.request(`/api/open/${method}`, JSON.stringify(signedRequest(this.config.userId, this.config.token, params)));
  }
  async order(orderId: string) {
    const data = await this.call("query-order", { out_trade_no: orderId });
    if (!Array.isArray(data.list)) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
    const order = data.list.map(object).find((item) => item.out_trade_no === orderId);
    if (!order) throw new HttpError(404, "AFDIAN_ORDER_NOT_FOUND");
    return order;
  }
  async sponsor(userId: string) {
    const data = await this.call("query-sponsor", { user_id: userId, page: 1, per_page: 100 });
    if (!Array.isArray(data.list)) throw new HttpError(502, "AFDIAN_INVALID_RESPONSE");
    return data.list.map(object).find((item) => object(item.user).user_id === userId) ?? null;
  }
  async oauth(code: string, redirectUri: string) {
    if (!this.config.oauth) throw new HttpError(503, "AFDIAN_OAUTH_UNAVAILABLE");
    const data = await this.request("/api/oauth2/access_token", new URLSearchParams({
      grant_type: "authorization_code", client_id: this.config.oauth.clientId,
      client_secret: this.config.oauth.clientSecret, code, redirect_uri: redirectUri,
    }).toString(), true);
    return identifier(data.user_id);
  }
}
