# 爱发电支付与订阅

## 范围与选型

爱发电为主支付渠道，使用官方 Open API、RSA-SHA256 Webhook 签名和 OAuth2 关联授权。协议实现采用 Node.js 内置 `fetch`、`crypto`，后台执行复用 pg-boss 与 PostgreSQL。Stripe 接口作为可选渠道保留，启用爱发电后面板默认展示爱发电订阅。

支付系统从空数据开始。KV 导入、旧支付记录迁移及历史格式兼容均不在开发范围。系统记录上线后的订单、核销与权益，供用户查询和故障恢复。

用户提供的两个链接为官方开发文档，套餐 ID 由商户配置。资料与章节索引见 [来源](../sources.md) 和 [爱发电文档索引](references/afdian-index.md)。

## 套餐与内容

`AFDIAN_PLANS_JSON` 声明本地套餐 ID、爱发电 plan ID、权益 key、是否永久、是否开放购买。服务启动检查配置与外部 ID 唯一性，权益变化递增 `rule_version`。已使用的本地套餐 ID 对应固定外部 ID，新增方案使用新的本地 ID。

worker 通过 `query-plan` 同步名称、描述、价格、周期与永久属性。初次同步成功后开放购买，展示资料超过 24 小时则暂停新的付款链接。商品、组合包、售票等类型进入后续专项开发；首期开放 `product_type=0` 的订阅与永久方案。

远端文案按文本展示，自动回复、随机兑换码库存等内容保持私有。本站权益由本地 key 表达，例如 `railround.premium`、`railround.export`；子站依据 key 开放具体功能或付费内容。订单保存购买时的规则版本，远端文案变化与新权益配置分别处理。

## 付款、关联与核销

1. 登录用户选择套餐与月数，中心创建随机 `custom_order_id` 和购买规则快照。付款链接传入 plan ID、month 与该随机标识。链接有效期 24 小时，同一幂等键返回同一链接。
2. 爱发电完成支付后发送 webhook。中心验证官方 RSA 签名，在同一 PostgreSQL 事务中保存加密原文、持久任务与 pg-boss 消息，提交后响应 `{"ec":200,"em":""}`。
3. worker 通过商户 `query-order` 重新读取订单，核对签名覆盖的四个字段，再通过 `query-sponsor` 查询有效期。官方签名未覆盖 `custom_order_id`、月数和状态，这些信息统一使用 API 结果。
4. 核销事务检查用户归属、外部方案、付款属性和购买快照，创建订单与权益。订单号唯一约束和购买标识的一次消费约束负责重复处理；原订单的关键属性出现冲突时记录任务失败。
5. 用户主动核销提交爱发电订单号。归属通过服务器创建的购买标识或已关联的爱发电账号确认，订单号本身仅用于查询。

付款链接到期限制再次获取付款地址。已经通过爱发电完成的订单允许延迟通知、断网恢复和后续 API 核销，关联标识持续保留到首次核销成功。

OAuth2 用于关联爱发电账号。中心登录会话、10 分钟有效的一次性 state、服务端换取的 user ID 共同确认归属。每个中心账号关联一个爱发电账号，外部账号保持唯一。OAuth2 需要向爱发电申请应用权限，未配置时仍可通过中心付款链接和订单核销完成订阅。

中心付款标识表达权益接收人；向他人分享付款链接，意味着该笔付款仍授予标识所属的中心账号。仅凭付款信息不自动建立外部账号关联。

## 订阅有效期

`query-sponsor` 的 `sponsor_plans` 与 `current_plan` 提供方案有效期。普通方案使用 `expire_time`，永久方案要求本地规则与平台永久属性一致。首次赞助数据尚未可见时，订单保留为已核销，权益等待后续同步确认。

每笔订单保存首次确认的权益期限，续费创建新的订单权益。后续同步可缩短有效期或停用权益，原订单的规则版本持续保留。有效订阅为当前全部有效订单权益的并集，视图直接按数据库时间判断到期。平台返回空方案时停用对应权益；查询失败会保留最后一次成功数据并标记同步失败。

官方文档仅明确 `status=2` 成功交易通知。中心对 API 返回的其他状态停止对应订单权益；平台侧退款、取消行为和通知覆盖需要商户联调确认。每日完整订单对账与每 15 分钟赞助者复核负责发现平台可查询的变化。

## Webhook 与 API 同步

| 触发方式 | 处理范围 | 完成标准 |
|---|---|---|
| Webhook | 验签订单入队，API 复核并核销 | 回应 200 表示持久接收，后台任务成功表示已处理 |
| 用户核销 | 指定订单与赞助状态 | 订单归属检查、权益事务提交 |
| 用户同步 | 已关联用户的赞助状态及全部订单分页 | 所有分页及核销子任务完成 |
| 每 15 分钟 | 套餐、已知用户赞助状态、最新两页订单 | 持久任务全部完成 |
| 每日 03:17，上海时区 | 完整订单分页、套餐和赞助状态 | 完整任务树完成 |
| 管理面板完整对账 | 与每日任务相同 | 全部子任务完成；失败可见并可重试 |

Open API 的订单接口按创建时间倒序分页，无更新时间游标。定期完整分页用于发现遗漏和已有订单状态变化；每页独立提交，重复发现通过订单唯一键处理。分页数据变化可能改变页边界，下一轮重叠查询和每日完整对账继续核验。

每 15 分钟的增量扫描跳过状态与关键属性均未变化的已确认订单，减少商户 API 请求；每日及人工完整对账重新查询所有发现的订单。

用户查询任务 API 会汇总递归子任务：任一失败则返回失败，全部成功才返回成功。查询期间返回 `pending` 和完成计数。后台任务记录永久保存，Webhook 原文加密保存，常规接口返回必要字段。商户令牌与原始个人地址等信息不进入管理面板。

## 数据与子站授权

| 对象 | 作用 |
|---|---|
| `core.billing_plans` | 套餐规则、版本及远端公开资料 |
| `core.billing_accounts` | 经 OAuth2 验证的统一身份关联 |
| `core.billing_oauth_states` | 一次性 OAuth2 state |
| `core.billing_checkouts` | 付款标识、购买时规则与消费记录 |
| `core.billing_orders` | 经商户 API 确认的订单及处理状态 |
| `core.billing_grants` | 各订单的版本化权益与有效期 |
| `core.billing_tasks` | 执行状态、父子关系、失败原因和结果 |
| `core.billing_events` | 已验证 webhook 的加密原文与处理任务 |
| `core.billing_entitlements_v1` | 有效权益的最小只读投影 |

子站后台通过已验证的中心用户 ID 查询权益。`sdk/entitlements.ts` 接受连接池或现有数据库事务；需要与业务数据一致时，在子站 `REPEATABLE READ` 事务内读取该视图。示例授权由数据库迁移角色执行，将 `site_railround_app` 替换成子站真实角色：

```sql
GRANT USAGE ON SCHEMA core TO site_railround_app;
GRANT SELECT ON core.billing_entitlements_v1 TO site_railround_app;
```

```ts
const allowed = await hasEntitlement(transaction, verifiedUser.id, "railround.premium");
```

权益视图仅返回中心用户 ID、权益 key 和有效期。该角色具有受信服务端的读取能力，用户过滤由已认证的子站后台执行。中心管理权限仅提供套餐和任务状态、订单分类计数；个人订单由用户本人查询。私有内容及解密权限仍由各子站管理。

## API 入口

| 方法与路径 | 使用者与结果 |
|---|---|
| `GET /v1/billing/plans` | 公开套餐及是否可购买 |
| `GET /v1/billing/subscription` | 本人订阅、关联状态与权益 |
| `GET /v1/billing/orders?limit=20&offset=0` | 本人分页订单 |
| `POST /v1/billing/afdian/checkout` | `{plan_id,months}`，创建付款链接 |
| `POST /v1/billing/afdian/link` | 创建 OAuth2 关联地址 |
| `GET /v1/billing/afdian/callback` | OAuth2 state/code 回调 |
| `POST /v1/billing/afdian/webhook` | 爱发电 RSA 验签入口 |
| `POST /v1/billing/afdian/redeem` | `{order_id}`，异步核销 |
| `POST /v1/billing/afdian/sync` | 同步本人全部支付状态 |
| `GET /v1/billing/tasks/:id` | 本人任务树状态 |
| `GET /v1/admin/billing` | 管理面板运行信息 |
| `POST /v1/admin/billing/sync` | 完整对账 |
| `GET /v1/admin/billing/tasks/:id` | 任务进度与状态 |
| `POST /v1/admin/billing/tasks/:id/retry` | 重试失败任务，保持原用户限制 |

checkout、redeem、sync 和管理重试使用 `Idempotency-Key`，长度 1 至 128，仅允许字母、数字、下划线和连字符。用户同步每分钟一次，核销和关联每分钟五次；所有用户写入请求校验 Origin。响应 202 的异步操作可按 `Location` 轮询。

## 部署配置

```dotenv
AFDIAN_USER_ID=商户后台的32位用户ID
AFDIAN_TOKEN=商户后台生成的API令牌
AFDIAN_PLANS_JSON=[{"id":"railround-monthly","planId":"实际的32位方案ID","entitlements":["railround.premium"],"permanent":false,"enabled":true}]
AFDIAN_OAUTH_CLIENT_ID=已申请的应用ID
AFDIAN_OAUTH_CLIENT_SECRET=应用密钥
```

`planId` 和商户 ID 须为真实的 32 位十六进制值。OAuth2 两项可同时留空，`AFDIAN_WEBHOOK_PUBLIC_KEY` 留空使用文档提供的官方 RSA 公钥。官方轮换公钥后可通过该变量更新 PEM，使用 `\n` 表示换行。

爱发电开发者后台通知地址：`https://你的中心域名/v1/billing/afdian/webhook`。OAuth2 回调：`https://你的中心域名/v1/billing/afdian/callback`。core 和 worker 使用相同配置。更新步骤：

```bash
git pull --ff-only
docker compose --env-file .env -f deploy/compose.yml build core
docker compose --env-file .env -f deploy/compose.yml --profile tools build migrate
docker compose --env-file .env -f deploy/compose.yml --profile tools run --rm migrate npm run db:migrate
docker compose --env-file .env -f deploy/compose.yml up -d core worker
docker compose --env-file .env -f deploy/compose.yml logs --tail 100 core worker
```

## 性能与验收

保留现有 core 512 MB、worker 256 MB、PostgreSQL 768 MB 的内存限制。支付与邮件、跨站任务使用不同队列，支付 worker 并发 1；全局数据库 advisory lock 保持多 worker 串行核销。外部 HTTP 调用在数据库业务事务之外执行，单次超时 5 秒，响应上限 2 MB，调用间隔至少 250 ms。Webhook 任务优先级高于定期扫描，失败最多执行六次并采用递增重试间隔。

目标主机验收：正常数据库条件下 webhook 持久接收 p95 小于 500 ms；外部 API 正常且无积压时，通知到权益可读 p95 小于 15 秒。浏览器每 15 秒刷新订阅，任务每 2 秒查询一次；子站授权读取数据库提交后的权益视图。平台支付完成到 webhook 抵达属于平台通知时间，单独记录。

上线前完成一次实际支付、重复通知、暂停 worker 后恢复、遗漏通知后的 API 核销、关联账号、续费与到期检查。面板检查套餐名称与价格，随后核对本人订单及子站授权。数据库记录中的 `first_seen_at` 表示中心首次确认时间，官方订单示例未提供明确付款时间字段。

本地测试使用真实 PostgreSQL、官方签名向量、测试 RSA 密钥和模拟 HTTP API。商户 API、OAuth2 应用与官方签名通知在部署账号配置后联调。

本地面板测试先执行 `npm run build`，随后按 README 启动 `SM_DEMO=1` 开发服务。`npm run test:billing-browser` 使用已启动服务和浏览器模拟响应检查套餐、订单分页、任务进度及核销；Windows 可设置 `BROWSER_CHANNEL=msedge`。截图保存在 `.local/screenshots/billing-*.png`。真实支付联调需通过环境变量提供 `AFDIAN_*` 配置，`dev:local` 会读取这些变量。
