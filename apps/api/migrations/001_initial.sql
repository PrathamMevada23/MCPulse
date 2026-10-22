CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  endpoint TEXT NOT NULL,
  transport_type TEXT NOT NULL CHECK (transport_type IN ('streamable_http')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  check_interval_seconds INTEGER NOT NULL CHECK (check_interval_seconds BETWEEN 30 AND 3600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE monitoring_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  status_code INTEGER,
  error_code TEXT,
  sanitized_error TEXT
);

CREATE INDEX monitoring_checks_server_checked_at_idx ON monitoring_checks (server_id, checked_at DESC);

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  summary TEXT NOT NULL,
  triggering_check_id UUID REFERENCES monitoring_checks(id) ON DELETE SET NULL
);

CREATE INDEX incidents_server_started_at_idx ON incidents (server_id, started_at DESC);
