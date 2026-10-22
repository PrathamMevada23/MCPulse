-- Migration 002: Tools, Test Profiles, and Tool-level Monitoring

CREATE TABLE mcp_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description TEXT,
  input_schema JSONB DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mcp_tools_server_name UNIQUE (server_id, name)
);

CREATE INDEX idx_mcp_tools_server_id ON mcp_tools (server_id);

CREATE TABLE tool_test_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  input_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  check_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (check_interval_seconds BETWEEN 30 AND 86400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_test_profiles_tool_id ON tool_test_profiles (tool_id);

CREATE TABLE tool_monitoring_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES tool_test_profiles(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  status_code INTEGER,
  error_code TEXT,
  sanitized_error TEXT,
  validation_passed BOOLEAN NOT NULL DEFAULT TRUE,
  validation_message TEXT,
  response_summary JSONB
);

CREATE INDEX idx_tool_checks_tool_checked_at ON tool_monitoring_checks (tool_id, checked_at DESC);
CREATE INDEX idx_tool_checks_server_checked_at ON tool_monitoring_checks (server_id, checked_at DESC);

CREATE TABLE tool_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES mcp_tools(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  summary TEXT NOT NULL,
  triggering_check_id UUID REFERENCES tool_monitoring_checks(id) ON DELETE SET NULL
);

CREATE INDEX idx_tool_incidents_tool_started_at ON tool_incidents (tool_id, started_at DESC);
