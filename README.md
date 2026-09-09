# 统一身份与服务中心

面向少于 200 名用户的 Node.js 服务中心，为多个 Vite/React、EdgeOne Pages/Function 项目提供统一身份、SSO、服务管理与一致的数据访问。

| 入口 | 内容 |
|---|---|
| [上机部署](docs/deployment.md) | Ubuntu/Compose 初始化、发布、备份恢复 |
| [子站接入](docs/integration.md) | SDK、Function、CRUD、签名命令和迁移 |
| [爱发电支付](docs/billing.md) | 套餐同步、Webhook、订单核销、订阅权益和联调 |
| [RailRound 迁移](../PyDesign/RailRound/docs/center-migration.md) | RailRound PostgreSQL 后端、profile 投影和人工切换 |
| [需求](docs/requirements.md) | 已确认业务和资源约束 |
| [系统设计](docs/design.md) | 组件选型、身份与服务模型 |
| [一致性标准](docs/consistency.md) | PostgreSQL 快照、任务等待、幂等与失败恢复 |
| [运行与部署标准](docs/operations.md) | 性能、资源预算、部署和备份 |
| [开发阶段](docs/implementation.md) | 阶段目标、验收和进展 |
| [项目记录](docs/memory.md) | 决策与文件入口 |
| [来源](sources.md) | 官方资料与完整章节索引 |

基准环境为 2 vCPU、4 GB 内存、3 Mbps 公网带宽，典型并发 5。采用 PostgreSQL、Better Auth、Fastify、pg-boss、Docker Compose 与 Caddy。各子站保持独立仓库和服务实例。

## 本地开发

Node.js 24 环境执行：

```powershell
npm ci
npm run build
$env:SM_DEMO="1"
$env:PORT="3001"
npm run dev:local
```

访问 **http://127.0.0.1:3001**。端口占用时将 `PORT` 改为 3002，访问对应地址。在另一个 PowerShell 窗口执行 `Get-Content -Encoding UTF8 .local/dev-account.json` 查看随机生成的测试账号。

命令启动仅监听本机的 PostgreSQL、API 和 worker，默认端口 3001。每次启动创建独立数据库，数据和账号位于忽略提交的 `.local/`。`SM_DEMO=1` 创建测试管理员和三个示例服务，示例链接使用保留测试域名；开发邮件查看 `/_dev/mail`。本地管理员可直接测试面板，正式环境要求邮箱已验证并启用 TOTP。

修改面板后执行 `npm run build` 并刷新；修改服务器代码后重启 `dev:local`。需要保留业务数据时使用外部 PostgreSQL。

已实现统一身份/OIDC、邮箱验证、GitHub 关联、TOTP/恢复码、服务注册、跨站查询、任务与签名命令、OSS 直传、爱发电支付订阅、可选 Stripe 接口及管理面板。存活检查为 `/health/live`，就绪检查为 `/health/ready`。

## 外部数据库

使用 `.env.example` 中的变量配置 PostgreSQL 连接。目标机使用 `deploy/compose.yml` 启动 PostgreSQL、core、worker 和 Caddy，详细步骤见 [上机部署](docs/deployment.md)。

```sh
npm run db:provision
npm run db:migrate
npm run dev
```

另一个终端执行 `npm run worker`。用户注册并验证邮箱后执行 `npm run admin:bootstrap -- user@example.com`，随后在账号安全中启用二次验证。首次部署需要配置 SMTP 与认证密钥。

`db:provision` 使用数据库管理权限创建项目专用角色和 schema，并设置运行账号密码，适用于专用开发数据库或首次部署。正式环境由运维准备 schema 和迁移角色，迁移身份需能 `SET ROLE sm_owner`；API 使用 `sm_app` 和 `sm_read` 的独立连接，启动过程不执行管理 DDL。初始化脚本重复执行会按配置更新运行账号密码。

## 检查与构建

```sh
npm run check
npm run build
npm start
```

`check` 执行 TypeScript 检查、真实 PostgreSQL 集成测试和生产构建。测试通过开发依赖 `embedded-postgres` 启动隔离实例，生产依赖不包含该组件；在普通用户权限下执行测试。测试数据只使用随机凭据并保留在 `.local/`，测试结束停止对应数据库进程。

`Dockerfile` 生成 Node.js 运行镜像，生产发布前固定基础镜像补丁和 digest，并按[运行标准](docs/operations.md)配置网络、密钥和资源限制。容器构建及目标 Ubuntu 容量验收在具备 Docker 的环境执行。

浏览器检查要求正在运行的 `SM_DEMO=1` 本地服务：在 PowerShell 设置 `$env:BROWSER_CHANNEL="msedge"` 后执行 `npm run test:browser`。也可执行 `npx playwright install chromium` 后使用默认 Chromium。截图位于 `.local/screenshots/`。
