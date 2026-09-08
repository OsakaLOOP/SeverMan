ALTER TABLE core.services ADD COLUMN origin text;
ALTER TABLE core.services ADD COLUMN api_url text;
ALTER TABLE core.services ADD COLUMN client_id text;
ALTER TABLE core.services ADD COLUMN scopes text[] NOT NULL DEFAULT ARRAY['openid','profile','email'];
ALTER TABLE core.services ADD COLUMN version integer NOT NULL DEFAULT 1;

CREATE TABLE core.admin_account (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.resources (
  id text PRIMARY KEY,
  service_id text NOT NULL REFERENCES core.services(id),
  schema_name text NOT NULL CHECK (schema_name ~ '^site_[a-z0-9_]+$'),
  view_name text NOT NULL CHECK (view_name ~ '^[a-z][a-z0-9_]*_v[0-9]+$'),
  user_column text NOT NULL DEFAULT 'user_id' CHECK (user_column ~ '^[a-z][a-z0-9_]*$'),
  sort_column text NOT NULL DEFAULT 'id' CHECK (sort_column ~ '^[a-z][a-z0-9_]*$'),
  columns text[] NOT NULL,
  UNIQUE(schema_name, view_name)
);
CREATE TABLE core.operations (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('snapshot','mail','webhook','command')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb,
  error_code text,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX operations_owner_time ON core.operations(user_id, created_at DESC);
CREATE TABLE core.operation_dependencies (
  operation_id uuid NOT NULL REFERENCES core.operations(id),
  dependency_id uuid NOT NULL REFERENCES core.operations(id),
  PRIMARY KEY(operation_id, dependency_id),
  CHECK (operation_id <> dependency_id)
);
CREATE TABLE core.uploads (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  object_key text UNIQUE NOT NULL,
  content_type text NOT NULL,
  expected_size bigint NOT NULL CHECK (expected_size BETWEEN 1 AND 10485760),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.payment_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.subscriptions (
  user_id text PRIMARY KEY,
  provider_id text UNIQUE NOT NULL,
  status text NOT NULL,
  price_id text,
  event_created bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA auth TO sm_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO sm_core;
REVOKE ALL ON core.schema_migrations, core.admin_account, core.resources FROM sm_core;
GRANT SELECT ON core.admin_account, core.resources TO sm_core;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core TO sm_core;
