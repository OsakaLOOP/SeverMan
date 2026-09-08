CREATE TABLE core.services (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{0,62}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA core TO sm_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.services TO sm_core;
