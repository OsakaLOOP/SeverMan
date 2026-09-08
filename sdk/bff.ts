import * as oidc from "openid-client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { seal, unseal } from "../src/security.js";
import { HttpError } from "../src/errors.js";

export interface BffOptions { issuer: string; clientId: string; clientSecret: string; origin: string; secret: string; pool: Pool; schema: string }
interface StoredTokens { access_token: string; refresh_token?: string; id_token?: string; expires_at: number }
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const cookie = (request: FastifyRequest, name: string) => request.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1);

export async function registerBff(app: FastifyInstance, options: BffOptions) {
  if (!/^site_[a-z0-9_]+$/.test(options.schema) || options.secret.length < 32) throw new Error("BFF schema 或密钥无效");
  const table = `"${options.schema}".sessions`;
  const issuer = new URL(options.issuer);
  const insecure = issuer.protocol === "http:" && ["127.0.0.1", "localhost"].includes(issuer.hostname);
  const client = await oidc.discovery(issuer, options.clientId, options.clientSecret, oidc.ClientSecretBasic(options.clientSecret), { timeout: 5, ...(insecure ? { execute: [oidc.allowInsecureRequests] } : {}) });
  const metadata = client.serverMetadata();
  const jwks = metadata.jwks_uri ? createRemoteJWKSet(new URL(metadata.jwks_uri)) : undefined;
  const suffix = `; Path=/; HttpOnly; SameSite=Lax${options.origin.startsWith("https:") ? "; Secure" : ""}`;
  const clear = (name: string) => `${name}=; Max-Age=0${suffix}`;
  app.get("/auth/login", async (_request, reply) => {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const transaction = seal({ verifier, state, nonce, expires: Date.now() + 300_000 }, options.secret);
    const url = oidc.buildAuthorizationUrl(client, { redirect_uri: `${options.origin}/auth/callback`, scope: "openid profile email offline_access", state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256" });
    return reply.header("set-cookie", `sm_login=${transaction}; Max-Age=300${suffix}`).redirect(url.href);
  });
  app.get("/auth/callback", async (request, reply) => {
    try {
      const transaction = unseal<{ verifier: string; state: string; nonce: string; expires: number }>(cookie(request, "sm_login") ?? "", options.secret);
      if (transaction.expires < Date.now()) throw new Error("授权已过期");
      const tokens = await oidc.authorizationCodeGrant(client, new URL(request.url, options.origin), { pkceCodeVerifier: transaction.verifier, expectedState: transaction.state, expectedNonce: transaction.nonce, idTokenExpected: true });
      const claims = tokens.claims();
      if (!claims) throw new Error("缺少用户身份");
      const session = randomBytes(32).toString("base64url");
      await options.pool.query(`INSERT INTO ${table}(token_digest,user_id,sid,tokens,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')`, [digest(session), claims.sub, claims.sid ?? null, seal({ ...tokens, expires_at: Date.now() + Number(tokens.expires_in ?? 300) * 1000 }, options.secret)]);
      return reply.header("set-cookie", [`sm_session=${session}; Max-Age=604800${suffix}`, clear("sm_login")]).redirect(options.origin);
    } catch {
      return reply.code(400).header("set-cookie", clear("sm_login")).send({ error: "LOGIN_CALLBACK_FAILED" });
    }
  });
  async function getUser(request: FastifyRequest, fresh = false) {
    const value = cookie(request, "sm_session");
    if (!value) return null;
    const connection = await options.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
      const session = (await connection.query(`SELECT * FROM ${table} WHERE token_digest=$1 AND expires_at>now() AND created_at>now()-interval '30 days' FOR UPDATE`, [digest(value)])).rows[0];
      if (!session) { await connection.query("COMMIT"); return null; }
      const tokens = unseal<StoredTokens>(session.tokens, options.secret);
      if (fresh || !session.checked_at || Date.now() - new Date(session.checked_at).getTime() > 30_000) {
        try {
          if (tokens.expires_at <= Date.now() + 5000 && tokens.refresh_token) {
            const refreshed = await oidc.refreshTokenGrant(client, tokens.refresh_token);
            Object.assign(tokens, refreshed, { expires_at: Date.now() + Number(refreshed.expires_in ?? 300) * 1000 });
          }
          const info = await oidc.fetchUserInfo(client, tokens.access_token, session.user_id);
          await connection.query(`UPDATE ${table} SET tokens=$2,profile=$3,checked_at=now() WHERE token_digest=$1`, [digest(value), seal(tokens, options.secret), JSON.stringify(info)]);
          session.profile = info;
        } catch (error) {
          const rejected = error instanceof oidc.WWWAuthenticateChallengeError || (error instanceof oidc.ResponseBodyError && ["invalid_grant", "invalid_token"].includes(error.error));
          if (!rejected) throw new HttpError(503, "IDENTITY_UNAVAILABLE");
          await connection.query(`DELETE FROM ${table} WHERE token_digest=$1`, [digest(value)]);
          await connection.query("COMMIT");
          return null;
        }
      }
      await connection.query("COMMIT");
      return { id: session.user_id as string, profile: session.profile as Record<string, unknown> };
    } catch (error) { await connection.query("ROLLBACK"); throw error; } finally { connection.release(); }
  }
  app.get("/auth/me", async (request, reply) => { const user = await getUser(request); return user ? user : reply.code(401).send({ error: "AUTH_REQUIRED" }); });
  app.post("/auth/logout", async (request, reply) => {
    if (request.headers.origin !== options.origin) return reply.code(403).send({ error: "ORIGIN_REJECTED" });
    const value = cookie(request, "sm_session");
    if (value) await options.pool.query(`DELETE FROM ${table} WHERE token_digest=$1`, [digest(value)]);
    return reply.header("set-cookie", clear("sm_session")).send({ success: true });
  });
  app.register(async (logout) => {
    logout.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => done(null, new URLSearchParams(String(body))));
    logout.post("/auth/backchannel-logout", async (request, reply) => {
      if (!jwks) return reply.code(503).send();
      try {
        const token = (request.body as URLSearchParams).get("logout_token") ?? "";
        const { payload } = await jwtVerify(token, jwks, { issuer: options.issuer, audience: options.clientId, algorithms: ["RS256"], maxTokenAge: "2m" });
        if (!payload.sid || !payload.jti || payload.nonce || !payload.events || !("http://schemas.openid.net/event/backchannel-logout" in Object(payload.events))) throw new Error("无效退出通知");
        await options.pool.query(`DELETE FROM ${table} WHERE sid=$1`, [payload.sid]);
        return { success: true };
      } catch { return reply.code(400).send({ error: "INVALID_LOGOUT" }); }
    });
  });
  return { getUser };
}
