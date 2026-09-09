# 子站接入

## 接入布局

Pages 托管 Vite/React；Function 使用 `sdk/edge-function.ts` 的 `createEdgeHandler(upstream, publicOrigin)` 转发同源 `/auth/*` 和 `/api/*`。Node.js BFF 使用 `sdk/bff.ts` 的 `registerBff`，issuer 为中心地址加 `/api/auth`，回调为本站公开来源加 `/auth/callback`。

浏览器持有本站 HttpOnly Cookie，令牌加密保存在本站 PostgreSQL。顶层 OIDC 跳转覆盖子域和独立域名。正式 EdgeOne 环境检查多个 Set-Cookie、重定向、超时及 Web API 兼容性。

SDK 为 TypeScript 源码，独立仓库引入 `sdk/`、`src/security.ts`、`src/errors.ts`，安装本项目锁定的 `openid-client`、`jose`、`fastify`、`pg`。React 使用 `sdk/react.tsx` 的 `useIdentity`、`LoginButton`。各站通过 BFF 获取身份。

## 可执行样板

1. 使用站点迁移角色执行 `examples/site/migration.sql`，为本站运行账号授权必要表读写权限。中心保持无本站写权限。
2. 面板注册本站 origin 和 `/auth/callback`，保存 client ID/secret。
3. 配置 `SITE_DATABASE_URL`、`SITE_ORIGIN`、`SITE_ISSUER`、`SITE_CLIENT_ID`、`SITE_CLIENT_SECRET`、`SITE_SESSION_SECRET`。session secret 至少 32 字符。
4. 执行 `npm run example:site`，访问 `/auth/login`；`/auth/me` 返回身份，`/api/notes` 提供用户隔离的分页 CRUD。

本地 origin 默认 `http://127.0.0.1:4100`，中心登记 native client 以允许 loopback；生产登记 HTTPS web client。样板提供 API，业务 React 页面由各站维护，上线时调整监听地址和容器配置。

RailRound 使用专用 profile 投影。中心只登记 `examples/railround-resource.json`，读取 `site_railround.profile_public_v1` 中的 `display_name`、会员等级、累计统计和公开徽章状态；中心 API 不返回 RailRound 的 trips、pins、folders、mileage events、card key、密码、外部账号 token 或订阅明细，也没有编辑该资料的路由。`/v1/site-profiles/railround` 在视图尚未登记时返回 `available=false`。

笔记列表参数 `after` UUID、`limit`，响应 `next_cursor`；PATCH 携带 `version`，过期版本返回 409。`getUser(request, true)` 强制在线核对授权，适合敏感修改。

## 只读资源

站点创建版本化视图，显式保留 user ID、当前用户内唯一的排序字段及可读字段。使用迁移身份执行：

```sh
npm run resource:register -- examples/site/resource.json
```

资源 JSON 中 service_id 应与面板登记的服务一致。查询按会话的内部用户 ID 过滤，管理员身份不扩大私有内容权限。同一请求的资源共享 PostgreSQL 只读快照，分页最多 100 条，offset 最大 10000。

向 `/v1/query` POST `{"resources":["notes"],"limit":20,"offset":0}`。加入 `after_operation_id` 时最多等待 2 秒；未完成返回 202，成功后建立快照，失败依赖返回 409。

## 签名命令与任务

`registerCommands` 注册 `/internal/commands`，子站 `SITE_COMMAND_SECRET` 与中心目标密钥一致。回调接收事务、用户 ID 和业务参数；数据库写入使用该事务，外部调用通过后续任务处理。

在中心 `WEBHOOK_TARGETS_JSON` 配置受信 HTTPS 目标：

```json
{"notes":{"url":"https://notes-api.example.com/internal/commands","secret":"独立的至少32字符随机密钥","commands":{"notes.create":"user"}}}
```

`user` 命令允许普通用户，`admin` 要求中心管理员。向 `/v1/operations` POST 以下正文并提供 `Idempotency-Key`：

```json
{"kind":"command","target":"notes","command":"notes.create","data":{"title":"示例笔记"},"dependencies":[]}
```

中心使用会话用户 ID 构造 HMAC 原文签名。子站在同一事务保存业务修改和 command_results，重复 operation ID 返回原结果，正文不同返回 409。提交响应包含 `operation_id`、`status=succeeded`、`result`，中心确认后标记完成。跨站组合使用操作依赖表达步骤，补偿采用独立业务命令。

普通通知使用 `kind=webhook`，签名包含事件 ID、时间戳和原文，接收端持久化去重。邮件带稳定 Message-ID，SMTP 接收后的故障重试可能重复投递。任务截止 15 分钟、最多执行 6 次，尚未开始的任务可取消。

## OSS 与订阅

配置 S3 兼容存储的 `S3_*`。`POST /v1/uploads` 返回 5 分钟有效的 PUT URL，直传后调用 `/v1/uploads/:id/confirm` 核对所有者、类型和大小。Bucket CORS 允许实际来源的 PUT/HEAD 和 Content-Type；图片通过 CDN/图片服务分发。配置未完成上传的生命周期清理。

爱发电为主支付渠道，配置 `AFDIAN_USER_ID`、`AFDIAN_TOKEN` 和 `AFDIAN_PLANS_JSON`；Webhook 地址 `/v1/billing/afdian/webhook`。付款关联、OAuth2、API 同步、异步核销及子站只读权益见 [支付接入](billing.md)。子站可使用 `sdk/entitlements.ts` 在业务事务中读取有效权益，页面按用户本人权限展示订单。

可选 Stripe 接口使用 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_IDS`，通知地址为 `/v1/billing/webhook`。

## 原有站点迁移

导出现有 KV 标识，建立 `旧站点ID + 旧用户ID -> 中心用户ID` 映射。用户登录旧账号与中心账号核验归属，邮箱用于联系。按站迁移数据和视图，暂停旧写入口后导入最后变更，再启用 BFF。保存旧数据和切换版本，核对条数、归属、分页和权限后开放。

运行期间以中心身份和各站 PostgreSQL 为权威数据，旧 KV 归档。评论、RSS、状态服务使用本站 schema，公开读取策略由所属服务定义。
