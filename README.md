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
