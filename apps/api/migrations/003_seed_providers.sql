-- Migration 003: Seed the five in-scope monitored MCP providers.
--
-- Scope (exactly five, no third-party MCP servers are installed or hosted):
--   1. GitHub
--   2. Google Drive
--   3. Brave Search
--   4. Cloudflare
--   5. Hugging Face
--
-- The insert is idempotent: a row is only written when no server with the same
-- name and endpoint already exists, so re-running the migration never creates
-- duplicates and never overwrites operator changes.

INSERT INTO mcp_servers (name, endpoint, transport_type, enabled, check_interval_seconds)
SELECT
  seed.name,
  seed.endpoint,
  'streamable_http',
  TRUE,
  60
FROM (
  VALUES
    ('GitHub Remote MCP', 'https://api.githubcopilot.com/mcp/'),
    ('Google Drive Remote MCP', 'https://drivemcp.googleapis.com/mcp/v1'),
    ('Brave Search MCP', 'https://api.search.brave.com/mcp'),
    ('Cloudflare Official Remote MCP', 'https://mcp.cloudflare.com/mcp'),
    ('Hugging Face Hub', 'https://huggingface.co/mcp')
) AS seed(name, endpoint)
WHERE NOT EXISTS (
  SELECT 1
  FROM mcp_servers existing
  WHERE existing.name = seed.name
    AND existing.endpoint = seed.endpoint
);
