# 项目记录

- 根目录入口为 `README.md`，系统设计见 `docs/design.md`，性能标准见 `docs/operations.md`。
- 用户于 2026-09-08 确认 PostgreSQL，按服务 schema 和角色隔离，跨站读取使用同库快照。
- `docs/requirements.md` 中资源规格为 2V4G3M，采用该配置制定预算；初次讨论的 4 核规格提供额外 CPU 余量。
- 用户确认内部账号统一、外部身份关联、公开注册、单一 admin、无团队协作，各站通过 SDK 可嵌入登录组件。
- 用户要求分阶段开发，独立修改分别提交。开发进展统一记录于 `docs/implementation.md`。
- 官方资料暂存于 `.research/`，该目录忽略提交；引用记录在 `sources.md`，章节索引在 `docs/references/`。
- 第一阶段服务入口为 `src/main.ts`，应用工厂为 `src/app.ts`。`npm run dev:local` 自动准备独立本地 PostgreSQL，正式配置入口为 `.env.example`。
- 本机没有 Docker 或预装 PostgreSQL；集成测试通过开发依赖 `embedded-postgres` 执行真实 SQL。生产使用标准 PostgreSQL 容器。
