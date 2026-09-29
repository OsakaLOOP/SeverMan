-- A deployment-only reservation survives deleting/recreating a user.
-- Runtime callers can only read it; ownership requires a verified email.
CREATE TABLE core.admin_email (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  email text UNIQUE NOT NULL CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON core.admin_email FROM sm_core;
GRANT SELECT ON core.admin_email TO sm_core;
