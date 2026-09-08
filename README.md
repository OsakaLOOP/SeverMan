# 统一身份与服务中心

面向少于 200 名用户的 Node.js 服务中心，为多个 Vite/React、EdgeOne Pages/Function 项目提供统一身份、SSO、服务管理与一致的数据访问。

| 入口 | 内容 |
|---|---|
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

```sh
npm ci
npm run dev:local
```

命令启动仅监听本机的开发 PostgreSQL、初始化角色、执行迁移并启动 API。默认 HTTP 端口为 3000，端口占用时依次尝试后续端口，控制台显示实际地址。每次启动创建独立数据库，数据目录位于忽略提交的 `.local/`，用于测试和开发；需要保留业务数据时使用下述外部数据库方式。

存活检查为 `/health/live`，就绪检查为 `/health/ready`。第一阶段提供后端基础，身份接口与管理面板按[开发阶段](docs/implementation.md)继续实现。

## 外部数据库

使用 `.env.example` 中的变量配置 PostgreSQL 连接。开发数据库可通过 `POSTGRES_PASSWORD` 和 `docker compose -f compose.dev.yml up -d` 启动。

```sh
npm run db:provision
npm run db:migrate
npm run dev
```

`db:provision` 使用数据库管理权限创建项目专用角色和 schema，并设置运行账号密码，适用于专用开发数据库或首次部署。正式环境由运维准备 schema 和迁移角色，迁移身份需能 `SET ROLE sm_owner`；API 使用 `sm_app` 和 `sm_read` 的独立连接，启动过程不执行管理 DDL。初始化脚本重复执行会按配置更新运行账号密码。

## 检查与构建

```sh
npm run check
npm run build
npm start
```

`check` 执行 TypeScript 检查、真实 PostgreSQL 集成测试和生产构建。测试通过开发依赖 `embedded-postgres` 启动隔离实例，生产依赖不包含该组件；在普通用户权限下执行测试。测试数据只使用随机凭据并保留在 `.local/`，测试结束停止对应数据库进程。

`Dockerfile` 生成 Node.js 运行镜像，生产发布前固定基础镜像补丁和 digest，并按[运行标准](docs/operations.md)配置网络、密钥和资源限制。容器构建及目标 Ubuntu 容量验收在具备 Docker 的环境执行。
