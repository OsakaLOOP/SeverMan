import { betterAuth } from "better-auth";
import { jwt, twoFactor } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { Pool } from "pg";
import type { PlatformConfig } from "./platform-config.js";
import { verificationEmail, resetPasswordEmail } from "./mail-templates.js";

export type SendMail = (to: string, subject: string, text: string, html?: string) => Promise<void>;

export function createAuth(config: PlatformConfig, pool: Pool, sendMail: SendMail, canManageClients: (userId: string) => Promise<boolean> = async () => false) {
  return betterAuth({
    appName: "SM 服务中心",
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.secret,
    database: pool,
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: config.requireVerification,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const mail = resetPasswordEmail(url);
        await sendMail(user.email, mail.subject, mail.text, mail.html);
      },
    },
    emailVerification: {
      sendOnSignUp: config.requireVerification,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        const mail = verificationEmail(url);
        await sendMail(user.email, mail.subject, mail.text, mail.html);
      },
    },
    socialProviders: config.github ? { github: config.github } : {},
    account: { accountLinking: { enabled: true, trustedProviders: [] }, encryptOAuthTokens: true },
    session: { expiresIn: 7 * 86400, disableSessionRefresh: true, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 60, storage: "database" },
    advanced: { database: { generateId: "uuid" }, ipAddress: { ipAddressHeaders: ["x-real-ip"] }, useSecureCookies: config.origin.startsWith("https:") },
    plugins: [
      twoFactor({ issuer: "SM", skipVerificationOnEnable: false }),
      jwt({ jwks: { keyPairConfig: { alg: "RS256" } } }),
      oauthProvider({
        loginPage: "/sign-in", consentPage: "/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        accessTokenExpiresIn: 300,
        m2mAccessTokenExpiresIn: 300,
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        clientPrivileges: async ({ user }) => user ? canManageClients(user.id) : false,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
