CREATE TABLE core.billing_plans (
  id text PRIMARY KEY,
  provider_plan_id text UNIQUE NOT NULL,
  rule_version integer NOT NULL DEFAULT 1,
  entitlements text[] NOT NULL,
  permanent boolean NOT NULL,
  enabled boolean NOT NULL,
  name text,
  description text,
  price_cents bigint,
  pay_month integer,
  remote_valid boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.billing_accounts (
  user_id text PRIMARY KEY,
  provider_user_id text UNIQUE NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);
CREATE TABLE core.billing_oauth_states (
  digest text PRIMARY KEY,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE core.billing_checkouts (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  plan_id text NOT NULL REFERENCES core.billing_plans(id),
  rule_version integer NOT NULL,
  entitlements text[] NOT NULL,
  permanent boolean NOT NULL,
  months integer NOT NULL CHECK (months BETWEEN 1 AND 36),
  order_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  UNIQUE(user_id,idempotency_key)
);
CREATE TABLE core.billing_orders (
  id text PRIMARY KEY,
  provider_user_id text NOT NULL,
  provider_plan_id text NOT NULL,
  user_id text,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  status integer NOT NULL,
  months integer NOT NULL,
  product_type integer NOT NULL,
  custom_order_id text,
  state text NOT NULL CHECK (state IN ('unclaimed','unmapped','review','granted','inactive')),
  source text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_orders_owner ON core.billing_orders(user_id,first_seen_at DESC,id);
CREATE INDEX billing_orders_provider_user ON core.billing_orders(provider_user_id);
CREATE TABLE core.billing_grants (
  order_id text PRIMARY KEY REFERENCES core.billing_orders(id),
  user_id text NOT NULL,
  plan_id text NOT NULL REFERENCES core.billing_plans(id),
  rule_version integer NOT NULL,
  entitlements text[] NOT NULL,
  permanent boolean NOT NULL,
  active boolean NOT NULL,
  period_confirmed boolean NOT NULL DEFAULT false,
  valid_until timestamptz,
  granted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (permanent OR valid_until IS NOT NULL)
);
CREATE INDEX billing_grants_owner ON core.billing_grants(user_id);
CREATE TABLE core.billing_tasks (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES core.billing_tasks(id),
  actor_id text,
  kind text NOT NULL CHECK (kind IN ('order','sponsor','plan','scan','reconcile')),
  request_key text UNIQUE NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','retrying','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_tasks_state ON core.billing_tasks(status,updated_at);
CREATE INDEX billing_tasks_parent ON core.billing_tasks(parent_id);
CREATE TABLE core.billing_events (
  id text PRIMARY KEY,
  order_id text NOT NULL,
  task_id uuid NOT NULL REFERENCES core.billing_tasks(id),
  payload_encrypted text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE VIEW core.billing_entitlements_v1 AS
  SELECT g.user_id, entitlement AS entitlement_key,
    CASE WHEN bool_or(g.permanent) THEN NULL ELSE max(g.valid_until) END AS valid_until
  FROM core.billing_grants g
  CROSS JOIN LATERAL unnest(g.entitlements) AS entitlement
  WHERE g.active AND (g.permanent OR g.valid_until>now())
  GROUP BY g.user_id,entitlement;
GRANT SELECT,INSERT,UPDATE,DELETE ON core.billing_plans,core.billing_accounts,core.billing_oauth_states,
  core.billing_checkouts,core.billing_orders,core.billing_grants,core.billing_tasks,core.billing_events TO sm_core;
GRANT SELECT ON core.billing_entitlements_v1 TO sm_core;
