# 分阶段开发

## 阶段 0：设计与选型

状态：已完成。

需求、PostgreSQL 数据组织、身份选型、一致性、部署和性能标准已记录。文档单独提交。

## 阶段 1：服务与数据库基础

状态：已完成代码与本地验收。

建立 TypeScript/Fastify 项目、配置校验、结构化日志、健康检查、PostgreSQL 连接池、迁移与 schema/角色隔离。提供一致快照读取模块、开发启动方式、容器配置和真实 PostgreSQL 集成测试。

验收：可启动和正常关闭；依赖中断时返回未就绪；迁移可重复执行并检测内容变更；只读角色无法写入；同一事务跨查询保持快照一致。

本地验证：Node.js 24.11.1，开发 PostgreSQL 18 包；6 项集成测试、类型检查与生产构建通过。已提供 Dockerfile 和开发数据库 Compose；本机没有 Docker，容器运行与目标 Ubuntu 性能测试归入部署验收。

代码入口：`src/app.ts`、`src/config.ts`、`src/db/`；迁移在 `migrations/`，初始化及本地运行脚本在 `scripts/`，集成测试在 `tests/foundation.test.ts`。

## 阶段 2：身份与服务注册

状态：已完成代码与本地验收。

已接入 Better Auth、OAuth Provider、GitHub 配置、邮件验证、OIDC 客户端和统一用户模型。服务注册 API、单一 admin、TOTP/恢复码、密码恢复和会话撤销已实现。认证库生成的 schema 纳入版本控制。

验收：注册、邮箱验证、账号关联、SSO、独立域名回调、会话撤销、权限越界与 CSRF；使用两个站点样板检查互操作。GitHub 和 SMTP 凭据由部署环境提供。

## 阶段 3：任务和跨站读取

状态：已完成代码与本地验收。

已接入 pg-boss、幂等操作、依赖等待、失败重试、只读视图注册、跨站快照和操作完成后的读取。签名命令由子站事务提交业务修改及幂等结果；工作进程每 15 秒恢复检查，执行租约 30 秒。恢复测试通过真实数据库构造中断后的持久状态，再启动新 worker 验证恢复。

验收：[一致性标准](consistency.md)全部场景；进程中止后恢复、无重复副作用、轮询限流和任务权限。

## 阶段 4：SDK、面板与迁移样板

状态：已完成 SDK、面板与可执行样板。

已提供 React 登录 SDK、Function/BFF 适配、六个面板视图和笔记分页 CRUD 样板。桌面 1440×1000、移动端 390×844 的登录、视图切换、注册弹窗、退出及溢出检查通过。现有站点仓库位于本项目之外，实际 KV 归属核验与切换按 [子站接入](integration.md) 执行。

验收：桌面和移动端主要流程、独立域名、正确传递 Cookie、权限和视图版本兼容、切换与回滚。

## 阶段 5：外围能力与部署验收

状态：已完成外围接口与部署文件，进入上机验收。

已完成 S3 兼容直传授权与确认、邮件、Webhook、Stripe Checkout/订阅事件、Compose/Caddy、迁移工具镜像、备份恢复脚本和定时单元。上机步骤见 [部署文档](deployment.md)。

验收：目标 Ubuntu 主机上的容量、带宽、延迟和恢复演练。支付网关与 OSS 厂商按实际账号接入。

## 验证记录与入口

本机已通过 16 项真实 PostgreSQL 集成测试、TypeScript 检查、生产构建、桌面/移动浏览器检查，生产依赖审计 0 项漏洞。测试覆盖 OIDC 两客户端、真实 HTTP BFF、PKCE/state、令牌轮换、邮件重置、TOTP/恢复码、全站撤销、跨站快照、签名命令、重复投递和任务恢复。支付已验证原文签名与事件去重。

Docker 运行、真实 GitHub/SMTP/OSS/Stripe 账号通信、EdgeOne 发布、实际站点迁移和整机性能在目标环境验收。性能数值属于验收目标。

源码入口：`src/auth.ts`、`src/platform.ts`、`src/jobs.ts`、`src/resources.ts`、`src/storage.ts`、`src/billing.ts`；SDK 在 `sdk/`，样板在 `examples/site/`，面板在 `web/`，部署在 `deploy/`。
