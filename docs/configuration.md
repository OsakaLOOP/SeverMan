# 统一配置

模板文件为 [`config/unified.template.json`](../config/unified.template.json)，覆盖服务进程、四类 PostgreSQL 连接、统一身份、GitHub、SMTP、S3、Stripe、爱发电和 Webhook 目标。`null` 表示关闭可选组件；复制模板后填写实际值，JSON 使用 UTF-8；密钥不提交到 Git。

## 字段填写

`schema_version` 固定为 `1`。`server.host` 和 `server.port` 是 core 监听地址，Docker 部署使用 `0.0.0.0:3000`；`log_level` 使用 `info`、`warn` 或 `error` 等标准日志级别；`trusted_proxy_cidrs` 填写 Caddy 或其他反向代理的容器网段，单机直连可使用空数组。

`database.database_url` 是 core 写连接，`read_database_url` 是跨站只读连接，`auth_database_url` 供 Better Auth 使用，`queue_database_url` 供 pg-boss 使用。四个地址都必须是 PostgreSQL URL，主机名、数据库名、账号和密码按 `deploy/compose.yml` 中的服务填写；当前 Compose 部署通常使用 `postgres` 作为主机名。数据库密码中的 `@`、`:`、`/` 等字符需要进行 URL 编码。

`auth.origin` 是统一登录中心的公开 HTTPS 根地址，例如 `https://auth.example.com`，不能填写 `/api/auth`；`auth.secret` 使用至少 32 个随机字符，并与启动环境中的 `AUTH_SECRET` 保持一致；`require_verification` 保持 `true` 可要求注册邮箱验证。认证密钥用于解密持久化配置，轮换时先修改环境变量并重启服务。

GitHub 集成填写 `integrations.github.client_id` 和 `client_secret`。两项来自 GitHub OAuth App，回调地址固定为 `https://中心域名/api/auth/callback/github`，开发环境则使用对应的本地中心地址。完成配置并重启 core/worker 后，登录页会出现 GitHub 登录入口；Better Auth 同时支持在已登录账号中关联 GitHub 身份。暂时不用 GitHub 时将整个字段设为 `null`。

`integrations.smtp` 填写 SMTP 主机、端口、TLS 开关、账号、密码和发件人地址，用于邮箱验证、密码重置和通知邮件。`integrations.storage` 对应 S3 兼容 OSS，填写 endpoint、region、bucket、访问密钥 ID 和密钥；上传采用预签名 URL，文件正文不经过 core。`integrations.stripe` 预留 Stripe secret、webhook secret 和 price ID 列表，未启用时设为 `null`。

`integrations.afdian` 填写爱发电商户 `userId`、API `token`、RSA webhook 公钥和套餐规则；`planId` 是爱发电后台的 32 位方案 ID，`id` 是中心内部唯一标识，`entitlements` 是授予子站的权益键，`permanent` 表示永久权益，`enabled` 控制套餐是否可用。需要爱发电账号关联时再填写 `oauth.clientId/clientSecret`，否则可删除该对象或保留空字符串。没有爱发电配置时将整个字段设为 `null`，模板中的占位符不能直接提交。

`integrations.webhook_targets` 是子站回调目标映射。每个目标使用 HTTPS `url`、至少 32 字符的 `secret` 和可选的 `commands` 权限表；没有目标时使用 `{}`。Webhook、套餐规则和已有爱发电连接支持进程内热更新，其他集成变更会提示重启。

管理员面板“管理”页的“统一配置”提供 JSON 文件载入、模板下载、语法与结构校验、版本检查、应用和变更记录。浏览器载入只在当前页面编辑，点击“应用配置”后通过 `/v1/admin/config/upload` 提交；服务器验证字段、外部 ID、URL、密钥长度并加密写入 PostgreSQL。配置变更以 `if_version` 乐观锁提交，旧版本同时修改会返回 `CONFIG_VERSION_CONFLICT`。

接口入口：`GET /v1/admin/config` 返回当前版本、脱敏配置和空密钥模板；`POST /v1/admin/config/validate` 只校验不保存；`PUT /v1/admin/config` 保存完整 JSON；`POST /v1/admin/config/upload` 作为文件上传后的保存入口；`PATCH /v1/admin/config` 对 JSON 对象执行受控合并；`GET /v1/admin/config/audit` 返回最近 100 条审计记录。所有入口要求管理员会话和二次验证。

命令行可在上机前检查已填写的文件：

```bash
npm run config:validate -- ./sm-unified-config.json
```

套餐规则、Webhook 目标和爱发电现有连接可以热更新，当前进程立即使用新值。服务监听、数据库连接、认证来源、认证密钥、GitHub、SMTP、S3、Stripe 变化会写入版本并返回重启路径，需按部署文档重启 core 和 worker；爱发电模块从未配置变为已配置同样需要重启以注册路由。认证密钥不能通过热更新轮换，先更新部署环境的 `AUTH_SECRET`，再重启服务并重新读取配置。

配置原文使用认证密钥加密存储，管理接口仅返回 `***`。审计记录保存版本、来源、变更路径和重启路径，不保存配置正文。服务启动先读取持久化版本，再初始化任务、支付和邮件组件；数据库中没有持久化配置时使用环境变量。

热更新流程：下载模板或当前脱敏配置，补充值后载入 JSON；点击“校验变更”确认热更新与需重启项；点击“应用配置”提交当前版本；页面显示版本和审计结果。需重启项执行：

```bash
docker compose --env-file .env -f deploy/compose.yml up -d core worker
```

生产发布前先备份数据库，使用 `git diff --check` 和 `docker compose ... config --quiet` 检查配置。配置文件、`.env`、数据库备份和恢复密钥按部署权限单独管理。
