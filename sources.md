# 参考来源

本设计的选型依据和协议入口如下。组件资料于 2026-09-08 核对，性能预算是项目验收标准，与厂商实测数据分别记录。

## 组件与运行标准

| 编号 | 官方来源 | 核对内容 |
|---|---|---|
| C01 | [Better Auth](https://www.better-auth.com/docs/introduction) | 账号、插件、社交登录与框架集成 |
| C02 | [OAuth Provider](https://www.better-auth.com/docs/plugins/oauth-provider) | OIDC、PKCE、资源 audience、刷新、撤销、Back-Channel Logout、事务 schema |
| C03 | [PostgreSQL 适配器](https://www.better-auth.com/docs/adapters/postgresql) | `pg.Pool`、自定义 schema 与迁移 |
| C04 | [会话管理](https://www.better-auth.com/docs/concepts/session-management) | 会话有效期、Cookie 缓存、撤销延迟 |
| C05 | [oidc-provider](https://github.com/panva/node-oidc-provider) | 标准协议、OpenID 认证、持久化集成 |
| C06 | [ZITADEL 部署](https://zitadel.com/docs/self-hosting/deploy/overview) | PostgreSQL 依赖，测试资源描述 |
| C07 | [Authentik Compose](https://docs.goauthentik.io/install-config/install/docker-compose/) | 2 核、2 GB 前提，PostgreSQL 和部署形态 |
| C08 | [EdgeOne Edge Functions](https://pages.edgeone.ai/document/edge-functions) | Web API、包体、请求正文与 CPU 限制 |
| C09 | [Node.js 发布](https://nodejs.org/en/about/previous-releases) | Node.js 24 LTS 和生产版本标准 |
| C10 | [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/) | 主版本维护和 Node.js 支持 |
| C11 | [Compose 服务配置](https://docs.docker.com/reference/compose-file/services/) | 内存、CPU、权限、健康检查和优雅停止 |
| C12 | [jose](https://github.com/panva/jose) | ESM、JWKS、签名、Web Crypto 兼容范围 |
| C13 | [openid-client](https://github.com/panva/openid-client) | 客户端协议、运行环境与认证信息 |
| C14 | [Nodemailer 连接池](https://nodemailer.com/smtp/pooled) | 连接复用、并发限制和内部重排 |
| C15 | [restic 备份](https://restic.readthedocs.io/en/stable/040_backup.html) | 备份调度、错误和空间管理 |
| C16 | [PostgreSQL 隔离](https://www.postgresql.org/docs/current/transaction-iso.html) | READ COMMITTED、REPEATABLE READ、冲突重试 |
| C17 | [pg-boss](https://github.com/timgit/pg-boss) | PostgreSQL 任务、事务提交、依赖和重试 |
| C18 | [node-postgres 连接池](https://node-postgres.com/guides/pool-sizing) | 多进程连接总量与管理余量 |

本轮所读页面的完整章节索引见 [组件文档索引](docs/references/components-index.md)。官方 README 使用 GitHub 原始地址或 jsDelivr 镜像暂存，引用指向官方仓库。技术实施仅继续读取直接相关的接口文档。

## 协议资料

- OpenID Connect Core 1.0：<https://openid.net/specs/openid-connect-core-1_0.html>
- OAuth 2.0 Security Best Current Practice（RFC 9700）：<https://www.rfc-editor.org/rfc/rfc9700.html>
- GitHub OAuth Apps 授权：<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>
- MDN Cookies：<https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies>
- MDN CORS：<https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS>

协议资料的章节索引见 [docs/references/index.md](docs/references/index.md)。
