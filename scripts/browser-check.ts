import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const account = JSON.parse(await readFile(".local/dev-account.json", "utf8")) as { email: string; password: string };
const origin = process.env.PREVIEW_ORIGIN ?? "http://127.0.0.1:3001";
await mkdir(".local/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.getByLabel("邮箱", { exact: true }).fill(account.email);
    await page.getByLabel("密码", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("heading", { name: "服务目录" }).waitFor();
    await page.screenshot({ path: `.local/screenshots/services-${viewport.width}.png`, fullPage: true });
    for (const tab of ["任务", "数据", "账号安全", "订阅", "管理", "服务"]) {
      await page.getByRole("navigation").getByRole("button", { name: tab, exact: true }).click();
      await page.getByRole("heading", { level: 1, name: tab, exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${tab} 页面横向溢出`);
      if (tab === "管理") {
        await page.getByRole("heading", { name: "统一配置", exact: true }).waitFor();
        await page.getByRole("textbox", { name: "配置 JSON" }).waitFor();
        await page.screenshot({ path: `.local/screenshots/config-${viewport.width}.png`, fullPage: true });
      }
    }
    await page.getByRole("button", { name: "注册服务", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `.local/screenshots/register-${viewport.width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "弹窗横向溢出");
    await page.getByRole("dialog").getByTitle("关闭").click();
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("桌面与移动端：登录、六个视图、注册弹窗、退出和溢出检查通过。");
} finally { await browser.close(); }
