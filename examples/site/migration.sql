-- 使用站点迁移角色创建，运行账号只获本站必要表权限。
CREATE SCHEMA IF NOT EXISTS site_example;
CREATE TABLE site_example.sessions (
  token_digest text PRIMARY KEY,
  user_id text NOT NULL,
  sid text,
  tokens text NOT NULL,
  profile jsonb,
  checked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON site_example.sessions(sid);
CREATE TABLE site_example.command_results (
  id uuid PRIMARY KEY,
  request_digest text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE site_example.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON site_example.notes(user_id,id);
CREATE VIEW site_example.notes_v1 AS SELECT id,user_id,title,version,created_at FROM site_example.notes;
