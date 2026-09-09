# 统一配置

模板文件为 [`config/unified.template.json`](../config/unified.template.json)，覆盖服务进程、四类 PostgreSQL 连接、统一身份、GitHub、SMTP、S3、Stripe、爱发电和 Webhook 目标。`null` 表示关闭可选组件；复制模板后填写实际值，JSON 使用 UTF-8；密钥不提交到 Git。

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
