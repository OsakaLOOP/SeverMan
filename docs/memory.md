# 项目记录

- 2026-09-09：支付以爱发电为主，用户确认不存在 KV 支付记录，支付按空数据开发，取消旧支付导入与兼容路线。
- 爱发电文档入口为 `docs/billing.md`；协议客户端在 `src/afdian-client.ts`，订单及任务在 `src/afdian.ts`，接口在 `src/afdian-routes.ts`，面板在 `web/src/billing.tsx`，子站权益查询在 `sdk/entitlements.ts`。
- 用户提供的两个 ifdian.net `/p/` 链接是开发文档。官方文档可通过网站公开的 `/api/post/get-detail?post_id=...` 获取内容，暂存 `.research/afdian-*.txt`；源码只使用文档确认的 Open API。
- 爱发电 webhook 签名覆盖订单号、用户 ID、套餐 ID、金额四项。核销先调用商户 API 验证完整订单，订阅有效期读取 sponsor 的 `expire_time`。OAuth2 负责外部账号关联。
- 统一配置入口为 `config/unified.template.json`；运行时版本和加密存储由 `src/runtime-config.ts` 负责，管理员 API 为 `/v1/admin/config`、`/v1/admin/config/upload`、`/v1/admin/config/validate`，面板组件为 `web/src/config-panel.tsx`。认证密钥轮换须通过环境变量和重启完成。
- 配置文件离线检查命令为 `npm run config:validate -- path/to/config.json`；静态模板保留可选组件为 `null`，填写真实凭据后再检查和上传。

- 根目录入口为 `README.md`，系统设计见 `docs/design.md`，性能标准见 `docs/operations.md`。
- 用户于 2026-09-08 确认 PostgreSQL，按服务 schema 和角色隔离，跨站读取使用同库快照。
- `docs/requirements.md` 中资源规格为 2V4G3M，采用该配置制定预算；初次讨论的 4 核规格提供额外 CPU 余量。
- 用户确认内部账号统一、外部身份关联、公开注册、单一 admin、无团队协作，各站通过 SDK 可嵌入登录组件。
- 用户要求分阶段开发，独立修改分别提交。开发进展统一记录于 `docs/implementation.md`。
- 官方资料暂存于 `.research/`，该目录忽略提交；引用记录在 `sources.md`，章节索引在 `docs/references/`。
- 第一阶段服务入口为 `src/main.ts`，应用工厂为 `src/app.ts`。`npm run dev:local` 自动准备独立本地 PostgreSQL，正式配置入口为 `.env.example`。
- 本机没有 Docker 或预装 PostgreSQL；集成测试通过开发依赖 `embedded-postgres` 执行真实 SQL。生产使用标准 PostgreSQL 容器。
- 面板为 `web/`，SDK 为 `sdk/`，笔记样板为 `examples/site/`。上机步骤见 `docs/deployment.md`，跨站对接见 `docs/integration.md`。
- 本地完整预览：先 build，`SM_DEMO=1`、`PORT=3001` 后执行 `npm run dev:local`，随机账号位于 `.local/dev-account.json`；每次启动独立数据库。
- 身份会话固定 7 天，BFF 的 userinfo 校验缓存最长 30 秒。`sdk/commands.ts` 将幂等结果和子站业务变更在同一事务提交。
- RailRound 迁移后端位于相邻仓库 `../PyDesign/RailRound/packages/railround-api/`，入口为 `src/server.ts`，SQL 迁移为 `migrations/001_railround.sql`，Pages 代理位于 `public/functions/api/railround/`，路线和切换步骤记录在该仓库 `docs/center-migration.md`。
