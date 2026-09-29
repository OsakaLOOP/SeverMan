import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { buildApp } from "../src/app.js";
import { startLocalPostgres } from "./local-postgres.js";
import { migrate } from "../src/db/migrations.js";
import { migrateQueue } from "./queue-migrate.js";

const database = await startLocalPostgres();
const origin = "http://127.0.0.1:3198";
const password = randomBytes(24).toString("base64url");
const email = "browser-admin@example.test";
const mail: {to: string; subject: string; text: string; html?: string}[] = [];
const app = buildApp({ host: "127.0.0.1", port: 3198, logLevel: "silent", databaseUrl: database.databaseUrl, readDatabaseUrl: database.readDatabaseUrl }, {
  config: { origin, secret: randomBytes(32).toString("hex"), authDatabaseUrl: database.databaseUrl, queueDatabaseUrl: database.databaseUrl, requireVerification: true, webhookTargets: {} },
  worker: true, captureMail: item => mail.push(item),
});
const browser = await chromium.launch({ headless: true });
try {
  await migrate(database.admin); await migrateQueue(database.adminUrl);
  await database.admin.query("INSERT INTO core.admin_email(email) VALUES($1)", [email]);
  await app.listen({ host: "127.0.0.1", port: 3198 });
  const page = await browser.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const heading = (name: string) => expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
  async function login(pass = password) {
    // Each scenario tests authentication, independently of the production rate limiter.
    await database.admin.query('DELETE FROM auth."rateLimit"');
    await page.getByLabel("邮箱", { exact: true }).fill(email);
    await page.getByLabel("密码", { exact: true }).fill(pass);
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await page.goto(origin + "/sign-up");
  await heading("创建账号");
  await page.getByLabel("昵称").fill("测试管理员");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await heading("等待邮箱验证");
  await expect.poll(() => mail.filter(item => item.to === email).length).toBe(1);
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await login(); await heading("等待邮箱验证");
  await page.getByRole("button", { name: "重新发送验证邮件" }).click();
  await expect.poll(() => mail.filter(item => item.to === email).length).toBe(2);
  const verification = mail.filter(item => item.to === email).at(-1)!;
  assert.ok(verification.html?.includes('<a href="'));
  await page.goto(verification.text.match(/https?:\/\/[^\s]+/)![0]);
  await expect(page.getByText("邮箱验证成功，请登录。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await login(); await heading("管理");
  await expect(page).toHaveURL(origin + "/admin");
  assert.equal((await page.request.get(origin + "/v1/admin/config")).status(), 403);
  await page.getByRole("button", { name: "设置二次验证", exact: true }).click();
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  const enabling = page.waitForResponse(response => response.url().endsWith("/api/auth/two-factor/enable"));
  await page.getByRole("button", { name: "设置验证器", exact: true }).click();
  const setup = await (await enabling).json();
  const secret = new URL(setup.totpURI).searchParams.get("secret")!;
  const otp = () => createOTP(new TextDecoder().decode(base32.decode(secret)), { digits: 6, period: 30 }).totp();
  await page.getByLabel("验证码", { exact: true }).fill(await otp());
  await page.getByRole("button", { name: "确认启用", exact: true }).click();
  await expect(page.getByText("已启用验证器保护", { exact: true })).toBeVisible();
  await page.getByRole("navigation").getByRole("button", { name: "管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "统一配置", exact: true })).toBeVisible();
  await page.reload(); await heading("管理");
  // A panel outage must not turn an authenticated user into an anonymous user.
  await page.route("**/v1/operations", route => route.fulfill({ status: 503, json: { error: { code: "INTERNAL_ERROR" } } }));
  await page.reload(); await heading("管理");
  await expect(page.getByRole("alert")).toContainText("部分工作区数据加载失败");
  await page.unroute("**/v1/operations");
  // A session outage must be visible instead of silently returning to the login form.
  await page.route("**/v1/me", route => route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR" } } }));
  await page.reload(); await heading("无法加载登录状态");
  await page.unroute("**/v1/me");
  await page.getByRole("button", { name: "重试", exact: true }).click(); await heading("管理");
  await page.getByRole("button", { name: "退出", exact: true }).click(); await heading("登录");
  await login("wrong-password-123"); await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确");
  await login(); await heading("二次验证");
  await page.getByRole("button", { name: "使用恢复码", exact: true }).click();
  await page.getByLabel("恢复码", { exact: true }).fill(setup.backupCodes[0]);
  await page.getByRole("button", { name: "验证并登录", exact: true }).click(); await heading("管理");
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.goto(origin + "/verify-result");
  await expect(page.getByText("请先通过邮件中的验证链接完成验证，再登录确认账号状态。", { exact: true })).toBeVisible();
  await page.goto(origin + "/api/auth/verify-email?token=invalid&callbackURL=" + encodeURIComponent(origin + "/verify-result?verified=1"));
  await expect(page.getByRole("alert")).toContainText("验证链接无效");
  await page.getByRole("button", { name: "忘记密码", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送重置邮件", exact: true }).click();
  await expect.poll(() => mail.filter(item => item.subject === "重置密码").length).toBe(1);
  await page.goto(mail.find(item => item.subject === "重置密码")!.text.match(/https?:\/\/[^\s]+/)![0]);
  await heading("设置新密码");
  await page.getByLabel("密码", { exact: true }).fill(password + "new");
  await page.getByRole("button", { name: "更新密码", exact: true }).click(); await heading("登录");
  await login(password + "new"); await heading("二次验证");
  await page.getByLabel("验证码", { exact: true }).fill(await otp());
  await page.getByRole("button", { name: "验证并登录", exact: true }).click(); await heading("管理");
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await database.admin.query('DELETE FROM auth."rateLimit"');
  await page.getByLabel("昵称").fill("普通用户");
  await page.getByLabel("邮箱", { exact: true }).fill("browser-user@example.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await heading("等待邮箱验证");
  await expect.poll(() => mail.some(item => item.to === "browser-user@example.test")).toBe(true);
  await page.goto(mail.find(item => item.to === "browser-user@example.test")!.text.match(/https?:\/\/[^\s]+/)![0]);
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("browser-user@example.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await heading("服务"); await expect(page).toHaveURL(origin + "/app");
  await expect(page.getByRole("navigation").getByRole("button", { name: "管理", exact: true })).toHaveCount(0);
  assert.equal((await page.request.get(origin + "/v1/admin/config")).status(), 403);
  await page.reload(); await heading("服务");
  // Expired sessions must drop cached workspace state and return to login.
  await database.admin.query('DELETE FROM auth.session WHERE "userId" IN (SELECT id FROM auth."user" WHERE email=$1)', ["browser-user@example.test"]);
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await heading("登录");
  assert.deepEqual(errors, []);
  console.log("真实浏览器通过：注册、待验证、补发、邮件链接、管理员落地、TOTP/恢复码、刷新、退出、错误恢复和重置密码。");
} finally { await browser.close(); await app.close(); await database.close(); }
