import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const account = JSON.parse(await readFile(".local/dev-account.json", "utf8")) as { email: string; password: string; origin: string };
const origin = process.env.PREVIEW_ORIGIN ?? account.origin;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
await mkdir(".local/screenshots", { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const until = new Date(Date.now() + 86400_000 * 30).toISOString();
    let polls = 0; let submitted = false; let offset = 0;
    await page.route("**/v1/config", (route) => route.fulfill({ json: { github: false, mail: true, storage: false, billing: true, afdian: true, afdian_oauth: true, prices: [] } }));
    await page.route("**/v1/billing/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/v1/billing/plans") return route.fulfill({ json: { items: [
        { id: "monthly", name: "月度会员", description: "行程统计、数据导出与会员内容", price_cents: 500, pay_month: 1, permanent: false, available: true },
        { id: "archive", name: "年度内容订阅与长期资料检索服务", description: "资料库、专题内容和完整统计", price_cents: 6000, pay_month: 12, permanent: false, available: false },
      ] } });
      if (url.pathname === "/v1/billing/subscription") return route.fulfill({ json: { subscription: {
        account: { provider_user_id: "b".repeat(32), synced_at: new Date().toISOString() },
        entitlements: [{ entitlement_key: "railround.premium", valid_until: until }], grants: [],
      } } });
      if (url.pathname === "/v1/billing/orders") {
        offset = Number(url.searchParams.get("offset"));
        return route.fulfill({ json: { items: Array.from({ length: offset ? 1 : 21 }, (_, i) => ({
          id: `20260909${String(i + offset).padStart(20, "0")}`, amount_cents: 500, name: "月度会员", months: 1, state: "granted", valid_until: until,
        })) } });
      }
      if (url.pathname === "/v1/billing/afdian/sync" || url.pathname === "/v1/billing/afdian/redeem") {
        assert.ok(route.request().headers()["idempotency-key"]);
        submitted = true; polls = 0;
        return route.fulfill({ status: 202, json: { id: "11111111-1111-4111-8111-111111111111", status: "pending" } });
      }
      if (url.pathname.includes("/tasks/")) {
        polls++;
        return route.fulfill({ json: { id: "11111111-1111-4111-8111-111111111111", status: polls > 1 ? "succeeded" : "pending", progress: { completed: polls > 1 ? 3 : 1, total: 3 } } });
      }
      return route.continue();
    });
    await page.route("**/v1/admin/billing", (route) => route.fulfill({ json: { orders: [{ state: "granted", count: 21 }], tasks: [{ id: "22222222-2222-4222-8222-222222222222", kind: "order", status: "failed", error_code: "AFDIAN_API_UNAVAILABLE" }] } }));
    await page.goto(origin);
    await page.getByLabel("邮箱", { exact: true }).fill(account.email);
    await page.getByLabel("密码", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("heading", { name: "服务目录" }).waitFor();
    await page.getByRole("navigation").getByRole("button", { name: "订阅", exact: true }).click();
    await page.getByRole("heading", { name: "爱发电订阅" }).waitFor();
    await page.getByRole("heading", { name: "月度会员", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "订阅页面横向溢出");
    await page.screenshot({ path: `.local/screenshots/billing-${viewport.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "同步订阅", exact: true }).click();
    await page.getByText("同步已完成", { exact: true }).waitFor();
    assert.equal(submitted, true); assert.ok(polls > 1);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByText("第 2 页").waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".billing-panel table")[0]?.querySelectorAll("tbody tr").length === 1);
    assert.equal(offset, 20);
    await page.getByLabel("爱发电订单号", { exact: true }).fill("20260909000000000001");
    await page.getByRole("button", { name: "核销订单", exact: true }).click();
    await page.getByText("同步已完成", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("爱发电面板桌面与移动端：套餐、订阅、任务等待、分页、核销及溢出检查通过。");
} finally { await browser.close(); }
