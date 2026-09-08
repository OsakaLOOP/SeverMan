# 上机部署

## 环境与配置

Ubuntu LTS，Docker Engine 和 Compose v2，预留 80/443，配置登录域名 A/AAAA 记录。仓库建议位于 `/opt/sm`。首次测试可在主机构建，后续由 CI 构建镜像并固定 digest。

```sh
cd /opt/sm
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：`AUTH_DOMAIN=auth.example.com`、`AUTH_ORIGIN=https://auth.example.com`。所有数据库 URL 的主机名改为 `postgres`；`POSTGRES_PASSWORD` 与 `MIGRATION_DATABASE_URL` 一致，`APP_DATABASE_PASSWORD` 与三个 `sm_app` URL 一致，`READ_DATABASE_PASSWORD` 与 `sm_read` URL 一致。随机密码至少 24 字符，`AUTH_SECRET` 至少 32 字符；可用 `openssl rand -hex 32` 分别生成。

公开邮箱注册配置 `SMTP_HOST/PORT/USER/PASSWORD/FROM/SECURE`。GitHub OAuth App 回调为 `https://auth.example.com/api/auth/callback/github`。外部密钥按 `.env.example` 填入；未配置的 OSS 和支付接口返回 503，面板显示未开放状态。

Compose 入口网络为 `172.30.0.0/24`，Caddy 地址 `172.30.0.2`，源站仅信任该代理。已有网段冲突时，同时修改 Compose 的网段、Caddy 地址与 `TRUSTED_PROXY_CIDRS`。

## 首次启动

以下命令均在仓库根目录执行：

```sh
docker compose --env-file .env -f deploy/compose.yml config --quiet
docker compose --env-file .env -f deploy/compose.yml up -d postgres
docker compose --env-file .env -f deploy/compose.yml build core
docker compose --env-file .env -f deploy/compose.yml --profile tools build migrate
docker compose --env-file .env -f deploy/compose.yml --profile tools run --rm migrate npm run db:provision
docker compose --env-file .env -f deploy/compose.yml --profile tools run --rm migrate npm run db:migrate
docker compose --env-file .env -f deploy/compose.yml up -d core worker caddy
```

迁移成功后发布 API。工具容器使用管理凭据；core/worker 仅接收运行凭据，数据库不映射公网端口。注册并完成邮箱验证后执行：

```sh
docker compose --env-file .env -f deploy/compose.yml --profile tools run --rm migrate npm run admin:bootstrap -- you@example.com
```

登录面板，在“账号安全”启用验证器并保存恢复码。client secret 只在服务注册结果中显示，保存到对应子站密钥配置。

## 上机检查

```sh
curl --fail https://auth.example.com/health/live
curl --fail https://auth.example.com/health/ready
curl --fail https://auth.example.com/api/auth/.well-known/openid-configuration
docker compose --env-file .env -f deploy/compose.yml ps
docker compose --env-file .env -f deploy/compose.yml logs --tail 100 core worker
docker stats --no-stream
```

测试注册邮件、TOTP、服务注册、独立域名登录、全站退出、子站 CRUD、命令后查询和已配置的直传/支付沙箱。停止 worker 后提交任务，重新启动 worker，确认任务完成。资源和延迟按 [运行标准](operations.md) 验收。

其他仓库接入 `sm_database` 网络，使用独立数据库账号、每服务最多两个连接，Caddy 增加各站域名并转发至相应 BFF。API 容器使用内部网络。

## 发布与回滚

备份后构建镜像、执行迁移、更新 core/worker。保留上一镜像 digest。应用回滚使用上一镜像和兼容 schema；恢复数据使用独立空数据库。任务重试沿用原 operation ID，各子站保留幂等记录。

已执行迁移按内容校验，后续变更新增迁移。Better Auth 升级先生成 schema 并审阅差异，再编写增量迁移。

## 备份与恢复

`deploy/backup.sh` 需要 PostgreSQL 18 客户端和 restic，并能连接数据库及异地仓库。宿主机执行时，`DATABASE_BACKUP_URL` 使用 PostgreSQL 容器私网地址，容器重建后更新地址；加入 `sm_database` 的运维容器可使用主机名 `postgres`。

配置 `DATABASE_BACKUP_URL`、`BACKUP_DIR`、`RESTIC_REPOSITORY`、`RESTIC_PASSWORD_FILE` 和仓库厂商凭据，首次执行 `restic init`。备份账号须可读全部待备份表和序列；数据库角色、`.env` 和加密密钥单独加密备份。

```sh
chmod +x deploy/backup.sh deploy/restore.sh
bash deploy/backup.sh
```

定时单元 `deploy/sm-backup.service` 和 `.timer` 每 30 分钟执行，默认用户 `sm-backup`、路径 `/opt/sm`、配置 `/etc/sm/backup.env`。创建该系统用户、配置目录权限并验证备份，再安装单元至 `/etc/systemd/system/`，执行 `systemctl enable --now sm-backup.timer`。定期执行 `restic check` 和低峰期 `restic prune`。

恢复顺序：取回 dump 和独立角色/密钥备份；创建角色及空数据库；设置 `RESTORE_DATABASE_URL`、`BACKUP_DUMP`、`CONFIRM_RESTORE=empty-database`；执行 `bash deploy/restore.sh`；核对权限、任务幂等记录和健康检查，再切换连接。恢复前仅准备角色，schema 由 dump 恢复；`db:provision` 会创建 schema，适用于首次初始化。

首次上线完成恢复演练。目标 RPO/RTO 均为 1 小时，最近成功时间位于 `BACKUP_DIR/last-success`。
