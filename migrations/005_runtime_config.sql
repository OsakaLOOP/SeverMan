CREATE TABLE core.runtime_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 0,
  payload_encrypted text NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.config_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version bigint NOT NULL,
  actor_id text,
  source text NOT NULL,
  changed_paths text[] NOT NULL,
  restart_required text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX config_audit_time ON core.config_audit(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON core.runtime_config, core.config_audit TO sm_core;
GRANT USAGE, SELECT ON SEQUENCE core.config_audit_id_seq TO sm_core;
