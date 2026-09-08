# 组件文档索引

核对日期：2026-09-08。记录本轮读取页面的全部章节标题；原始页面和正文暂存在 `.research/`。

## PostgreSQL 事务隔离

来源：<https://www.postgresql.org/docs/current/transaction-iso.html>

  - [13.2. Transaction Isolation #](https://www.postgresql.org/docs/current/transaction-iso.html)
    - Important
    - 13.2.1. Read Committed Isolation Level #
    - 13.2.2. Repeatable Read Isolation Level #
    - Note
    - 13.2.3. Serializable Isolation Level #
  - [Submit correction](https://www.postgresql.org/docs/current/transaction-iso.html)

## pg-boss

来源：<https://github.com/timgit/pg-boss>

  - [Summary](https://github.com/timgit/pg-boss)
  - [CLI](https://github.com/timgit/pg-boss)
  - [Dashboard](https://github.com/timgit/pg-boss)
  - [Proxy](https://github.com/timgit/pg-boss)
  - [Requirements](https://github.com/timgit/pg-boss)
  - [Sponsors](https://github.com/timgit/pg-boss)
  - [Documentation](https://github.com/timgit/pg-boss)
  - [Contributing](https://github.com/timgit/pg-boss)

## node-postgres 连接池

来源：<https://node-postgres.com/guides/pool-sizing>

  - [Simple apps, dev mode, fixed instance counts, etc.](https://node-postgres.com/guides/pool-sizing#simple-apps-dev-mode-fixed-instance-counts-etc)
  - [Auto-scaling, cloud-functions, multi-tenancy, etc.](https://node-postgres.com/guides/pool-sizing#auto-scaling-cloud-functions-multi-tenancy-etc)
    - Vercel
    - Cloudflare workers
  - [pg-bouncer, RDS-proxy, etc.](https://node-postgres.com/guides/pool-sizing#pg-bouncer-rds-proxy-etc)
  - [Conclusion, tl;dr](https://node-postgres.com/guides/pool-sizing#conclusion-tldr)
  - [Need help?](https://node-postgres.com/guides/pool-sizing#need-help)

## Better Auth PostgreSQL

来源：<https://www.better-auth.com/docs/adapters/postgresql>

- [PostgreSQL](https://www.better-auth.com/docs/adapters/postgresql)
  - [Example Usage](https://www.better-auth.com/docs/adapters/postgresql#example-usage)
  - [Schema generation & migration](https://www.better-auth.com/docs/adapters/postgresql#schema-generation--migration)
  - [Joins](https://www.better-auth.com/docs/adapters/postgresql#joins)
  - [Use a non-default schema](https://www.better-auth.com/docs/adapters/postgresql#use-a-non-default-schema)
    - Option 1: Set search_path in connection string (Recommended)
    - Option 2: Set search_path using Pool options
    - Option 3: Set default schema for database user
    - Prerequisites
    - How it works
    - Troubleshooting
  - [Additional Information](https://www.better-auth.com/docs/adapters/postgresql#additional-information)
    - On this page

## Better Auth

来源：<https://www.better-auth.com/docs/introduction>

- [Introduction](https://www.better-auth.com/docs/introduction)
  - [Features](https://www.better-auth.com/docs/introduction#features)
  - [AI resources](https://www.better-auth.com/docs/introduction#ai-resources)
    - On this page

## Better Auth OAuth Provider

来源：<https://www.better-auth.com/docs/plugins/oauth-provider>

- [OAuth 2.1 Provider](https://www.better-auth.com/docs/plugins/oauth-provider)
  - [Installation](https://www.better-auth.com/docs/plugins/oauth-provider#installation)
    - Mount the Plugin
    - Migrate the Database
    - Confirm /.well-known endpoints
    - Create your first OAuth client
  - [Client Plugins](https://www.better-auth.com/docs/plugins/oauth-provider#client-plugins)
    - OAuth Client
    - Resource Client
  - [Usage](https://www.better-auth.com/docs/plugins/oauth-provider#usage)
    - OAuth Clients
      - Get Client
      - Get Public Client
      - Get Public Client Prelogin
      - List Clients
      - Create Client
      - Update Client
      - Rotate Client Secret
      - Delete Client
    - OAuth Consent
      - Get Consent
      - List Consent
      - Update Consent
      - Delete Consent
    - Dynamic Registration Endpoint
      - Setup
      - Basic Example
    - Authorize Endpoint
    - Token Endpoint
      - Client Authentication Methods
      - DPoP sender-constrained tokens
      - Private Key JWT Authentication
      - Authorization code grant
      - Client credentials grant
      - Refresh token grant
      - Device code grant
    - Consent Endpoint
    - Continue Endpoint
    - Introspect Endpoint
      - Who can introspect a token
      - Which claims come back
    - Revoke Endpoint
    - End Session Endpoint
    - Back-Channel Logout
    - UserInfo Endpoint
    - Well-Known
      - OpenID Configuration
      - OAuth Authorization Server
  - [API Server](https://www.better-auth.com/docs/plugins/oauth-provider#api-server)
    - Verification
      - JWT Verification
      - Opaque Access Tokens
      - Recommendations
    - Scopes vs. Permissions
  - [Configuration](https://www.better-auth.com/docs/plugins/oauth-provider#configuration)
    - Redirect Screens
      - Login Screen
      - Consent Screen
      - Sign Up Account Screen
      - Select Account Screen
      - Post Login Screen
    - Cached Trusted Clients
    - Resources
    - Scopes
    - Claims
      - Custom Token Response Fields
    - Expirations
    - Registration
      - Dynamic Client Registration
      - Dynamic Client Registration Expiration
      - Dynamic Client Registration Scopes
    - PKCE Configuration
      - Default Behavior
      - Per-Client PKCE Configuration
      - Dynamic Client Registration PKCE Configuration
      - Security Considerations
    - Unauthenticated client discovery
    - Provider extensions
      - Provider capabilities outside a grant
      - Client authentication obligations
      - Claim precedence
    - Organizations
    - Client CRUD Privileges
    - Storage
    - Rate Limiting
    - Refresh Token Customization
    - Advertised Metadata
      - Scopes
      - Claims
    - Disable JWT Plugin
    - Pairwise Subject Identifiers
      - Per-Client Configuration
      - How It Works
    - MCP
  - [Schema](https://www.better-auth.com/docs/plugins/oauth-provider#schema)
    - OAuth Client
    - OAuth Refresh Token
    - OAuth Access Token
    - OAuth Consent
    - OAuth Client Assertion
  - [Options](https://www.better-auth.com/docs/plugins/oauth-provider#options)
    - Prefix
  - [Optimizations](https://www.better-auth.com/docs/plugins/oauth-provider#optimizations)
    - On this page

## Better Auth SQLite

来源：<https://www.better-auth.com/docs/adapters/sqlite>

- [SQLite](https://www.better-auth.com/docs/adapters/sqlite)
  - [Example Usage](https://www.better-auth.com/docs/adapters/sqlite#example-usage)
    - Better-SQLite3 (Recommended)
    - Node.js Built-in SQLite (Release Candidate)
    - Bun Built-in SQLite
  - [Schema generation & migration](https://www.better-auth.com/docs/adapters/sqlite#schema-generation--migration)
  - [Joins](https://www.better-auth.com/docs/adapters/sqlite#joins)
  - [Additional Information](https://www.better-auth.com/docs/adapters/sqlite#additional-information)
    - On this page

## Better Auth 会话

来源：<https://www.better-auth.com/docs/concepts/session-management>

- [Session Management](https://www.better-auth.com/docs/concepts/session-management)
  - [Session table](https://www.better-auth.com/docs/concepts/session-management#session-table)
  - [Session Expiration](https://www.better-auth.com/docs/concepts/session-management#session-expiration)
    - Disable Session Refresh
    - Defer Session Refresh
  - [Session Freshness](https://www.better-auth.com/docs/concepts/session-management#session-freshness)
  - [Session Management](https://www.better-auth.com/docs/concepts/session-management#session-management)
    - Get Session
    - Use Session
    - List Sessions
    - Revoke Session
    - Revoke Other Sessions
    - Revoke All Sessions
    - Update Session
    - Revoking Sessions on Password Change
  - [Session Caching](https://www.better-auth.com/docs/concepts/session-management#session-caching)
    - Cookie Cache
      - Cookie Cache Strategies
    - JWKS-backed cookie-cache JWTs
  - [Sessions in Secondary Storage](https://www.better-auth.com/docs/concepts/session-management#sessions-in-secondary-storage)
    - Storing Sessions in the Database
    - Preserving Sessions
  - [Stateless Session Management](https://www.better-auth.com/docs/concepts/session-management#stateless-session-management)
    - Basic Stateless Setup
    - Understanding refreshCache
    - Versioning Stateless Sessions
    - Stateless with Secondary Storage
  - [Customizing Session Response](https://www.better-auth.com/docs/concepts/session-management#customizing-session-response)
    - Caveats on Customizing Session Response
    - On this page

## oidc-provider

来源：<https://github.com/panva/node-oidc-provider>

- [oidc-provider](https://github.com/panva/node-oidc-provider)
  - [Implemented specs & features](https://github.com/panva/node-oidc-provider)
  - [Certification](https://github.com/panva/node-oidc-provider)
  - [Sponsor](https://github.com/panva/node-oidc-provider)
  - [Support](https://github.com/panva/node-oidc-provider)
  - [[Documentation](/docs/README.md) & Configuration](https://github.com/panva/node-oidc-provider)
  - [Community Guides](https://github.com/panva/node-oidc-provider)
  - [Events](https://github.com/panva/node-oidc-provider)
  - [Supported Versions](https://github.com/panva/node-oidc-provider)

## ZITADEL 部署

来源：<https://zitadel.com/docs/self-hosting/deploy/overview>

- [Deploy ZITADEL](https://zitadel.com/docs/self-hosting/deploy/overview)
  - [Prerequisites](https://zitadel.com/docs/self-hosting/deploy/overview#prerequisites)
  - [Releases](https://zitadel.com/docs/self-hosting/deploy/overview#releases)
  - [Production Setup](https://zitadel.com/docs/self-hosting/deploy/overview#production-setup)
    - On this page

## Authentik 部署

来源：<https://docs.goauthentik.io/install-config/install/docker-compose/>

- [Docker Compose installation](https://docs.goauthentik.io/install-config/install/docker-compose/)
  - [Requirements​](https://docs.goauthentik.io/install-config/install/docker-compose/#requirements)
  - [Video​](https://docs.goauthentik.io/install-config/install/docker-compose/#video)
  - [Download the Compose file​](https://docs.goauthentik.io/install-config/install/docker-compose/#download-the-compose-file)
  - [Generate PostgreSQL password and secret key​](https://docs.goauthentik.io/install-config/install/docker-compose/#generate-postgresql-password-and-secret-key)
  - [Configure custom ports​](https://docs.goauthentik.io/install-config/install/docker-compose/#configure-custom-ports)
  - [Docker socket​](https://docs.goauthentik.io/install-config/install/docker-compose/#docker-socket)
  - [Email configuration (optional but recommended)​](https://docs.goauthentik.io/install-config/install/docker-compose/#email-configuration-optional-but-recommended)
  - [Install and start authentik​](https://docs.goauthentik.io/install-config/install/docker-compose/#install-and-start-authentik)
  - [Access authentik​](https://docs.goauthentik.io/install-config/install/docker-compose/#access-authentik)
  - [First steps in authentik​](https://docs.goauthentik.io/install-config/install/docker-compose/#first-steps-in-authentik)
  - [📄️First steps](https://docs.goauthentik.io/install-config/install/docker-compose/)

## EdgeOne Edge Functions

来源：<https://pages.edgeone.ai/document/edge-functions>

- [Edge Functions](https://pages.edgeone.ai/document/edge-functions)
    - Overview
    - Strengths
    - Quick Start
    - Routing
    - Function Handlers
    - Runtime APIs
    - Use Limits
    - Sample Template

## Node.js 发布周期

来源：<https://nodejs.org/en/about/previous-releases>

- [Node.js Releases](https://nodejs.org/en/about/previous-releases#nodejs-releases)
  - [Release Schedule](https://nodejs.org/en/about/previous-releases#release-schedule)
  - [Looking for the latest release of a version branch?](https://nodejs.org/en/about/previous-releases#looking-for-the-latest-release-of-a-version-branch)
  - [Official vs. Community Installation Methods](https://nodejs.org/en/about/previous-releases#official-vs-community-installation-methods)
    - Official Installation Methods
    - Community Installation Methods

## Fastify 支持周期

来源：<https://fastify.dev/docs/latest/Reference/LTS/>

  - [Long Term Support](https://fastify.dev/docs/latest/Reference/LTS/#long-term-support)
  - [Security Releases and Semver](https://fastify.dev/docs/latest/Reference/LTS/#security-releases-and-semver)
    - Security Support Beyond LTS
    - Schedule
    - CI Tested Operating Systems
    - Docs
    - Community
    - More

## Docker Compose 服务配置

来源：<https://docs.docker.com/reference/compose-file/services/>

    - What can I help you with?
- [Define services in Docker Compose](https://docs.docker.com/reference/compose-file/services/)
  - [Examples](https://docs.docker.com/reference/compose-file/services/#examples)
    - Simple example
    - Advanced example
  - [Attributes](https://docs.docker.com/reference/compose-file/services/#attributes)
    - annotations
    - attach
    - build
    - blkio_config
      - device_read_bps, device_write_bps
      - device_read_iops, device_write_iops
      - weight
      - weight_device
    - cpu_count
    - cpu_percent
    - cpu_shares
    - cpu_period
    - cpu_quota
    - cpu_rt_runtime
    - cpu_rt_period
    - cpus
    - cpuset
    - cap_add
    - cap_drop
    - cgroup
    - cgroup_parent
    - command
    - configs
      - Short syntax
      - Long syntax
    - container_name
    - credential_spec
      - Example gMSA configuration
    - depends_on
      - Short syntax
      - Long syntax
    - deploy
    - develop
    - device_cgroup_rules
    - devices
    - dns
    - dns_opt
    - dns_search
    - domainname
    - driver_opts
    - entrypoint
    - env_file
      - required
      - format
      - Env_file format
    - environment
    - expose
    - extends
      - Restrictions
      - Finding referenced service
      - Merging service definitions
        - Mappings
        - Sequences
        - Scalars
    - external_links
    - extra_hosts
      - Short syntax
      - Long syntax
    - gpus
    - group_add
    - healthcheck
    - hostname
    - image
    - init
    - ipc
    - isolation
    - labels
    - label_file
    - links
    - logging
    - mac_address
    - mem_limit
    - mem_reservation
    - mem_swappiness
    - memswap_limit
    - models
      - Long syntax
    - network_mode
    - networks
      - Implicit default network
      - aliases
      - interface_name
      - ipv4_address, ipv6_address
      - link_local_ips
      - mac_address
      - driver_opts
      - gw_priority
      - priority
    - oom_kill_disable
    - oom_score_adj
    - pid
    - pids_limit
    - platform
    - ports
      - Short syntax
      - Long syntax
    - post_start
    - pre_start
    - pre_stop
    - privileged
    - profiles
    - provider
      - type
      - options
    - pull_policy
    - read_only
    - restart
    - runtime
    - scale
    - secrets
      - Short syntax
      - Long syntax
    - security_opt
    - shm_size
    - stdin_open
    - stop_grace_period
    - stop_signal
    - storage_opt
    - sysctls
    - tmpfs
    - tty
    - ulimits
    - use_api_socket
    - user
    - userns_mode
    - uts
    - volumes
      - Short syntax
      - Long syntax
    - volumes_from
    - working_dir

## jose

来源：<https://github.com/panva/jose>

- [jose](https://github.com/panva/jose)
  - [Sponsor](https://github.com/panva/jose)
  - [[💗 Help the project](https://github.com/sponsors/panva)](https://github.com/panva/jose)
  - [Dependencies: 0](https://github.com/panva/jose)
  - [Documentation](https://github.com/panva/jose)
    - JSON Web Tokens (JWT)
    - Encrypted JSON Web Tokens
    - Key Utilities
    - JSON Web Signature (JWS)
    - JSON Web Encryption (JWE)
    - Other
  - [Supported Runtimes](https://github.com/panva/jose)
  - [Supported Versions](https://github.com/panva/jose)
  - [Specifications](https://github.com/panva/jose)

## openid-client

来源：<https://github.com/panva/openid-client>

- [openid-client](https://github.com/panva/openid-client)
  - [Features](https://github.com/panva/openid-client)
  - [Sponsor](https://github.com/panva/openid-client)
  - [[Certification](https://openid.net/certification/faq/)](https://github.com/panva/openid-client)
  - [[💗 Help the project](https://github.com/sponsors/panva)](https://github.com/panva/openid-client)
  - [[API Reference Documentation](docs/README.md)](https://github.com/panva/openid-client)
  - [[Examples](examples/README.md)](https://github.com/panva/openid-client)
  - [Quick start](https://github.com/panva/openid-client)
    - Authorization Code Flow
    - Device Authorization Grant (Device Flow)
    - Client-Initiated Backchannel Authentication (CIBA)
    - Client Credentials Grant
  - [Supported Runtimes](https://github.com/panva/openid-client)
  - [Supported Versions](https://github.com/panva/openid-client)

## Nodemailer 连接池

来源：<https://nodemailer.com/smtp/pooled>

- [Pooled SMTP Connections](https://nodemailer.com/smtp/pooled)
  - [Quick example​](https://nodemailer.com/smtp/pooled#quick-example)
  - [Transport options​](https://nodemailer.com/smtp/pooled#transport-options)
  - [Runtime helpers​](https://nodemailer.com/smtp/pooled#runtime-helpers)
    - transporter.isIdle() -> boolean​
    - transporter.close()​
  - [Event: idle​](https://nodemailer.com/smtp/pooled#event-idle)
  - [Event: clear​](https://nodemailer.com/smtp/pooled#event-clear)
    - Best practices​
  - [See Also​](https://nodemailer.com/smtp/pooled#see-also)

## restic 备份

来源：<https://restic.readthedocs.io/en/stable/040_backup.html>

- [Backing up](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [File change detection](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Skip creating snapshots if unchanged](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Absolute and relative paths](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Dry runs](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Excluding files](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Including files](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Comparing snapshots](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Backing up special items and metadata](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Reading data from a command](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Reading data from stdin](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Tags for backup](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Scheduling backups](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Space requirements](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Exit status codes](https://restic.readthedocs.io/en/stable/040_backup.html)
  - [Environment variables](https://restic.readthedocs.io/en/stable/040_backup.html)
