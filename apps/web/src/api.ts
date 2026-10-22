/**
 * Same-origin by default: the browser calls the API through the reverse proxy
 * that serves this bundle, so the same relative URLs work in local development
 * (Vite dev proxy) and in the AWS deployment (nginx). Set VITE_API_BASE_URL at
 * build time only when the API is hosted on a different origin.
 */
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export type ServerStatus =
  'healthy' | 'degraded' | 'down' | 'unknown' | 'disabled';
export type DashboardServer = {
  id: string;
  name: string;
  endpoint: string;
  enabled: boolean;
  checkIntervalSeconds: number;
  status: ServerStatus;
  lastCheckedAt: string | null;
  lastDurationMs: number | null;
  hasOpenIncident: boolean;
};
export type Check = {
  id: string;
  checkedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  statusCode: number | null;
  errorCode: string | null;
  sanitizedError: string | null;
};
export type Incident = {
  id: string;
  serverId?: string;
  serverName?: string;
  state: 'open' | 'resolved';
  summary: string;
  startedAt: string;
  resolvedAt: string | null;
};
export type DashboardSummary = {
  counts: Record<ServerStatus, number>;
  servers: DashboardServer[];
  incidents: Incident[];
};

export type McpTool = {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  active: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt?: string | null;
  lastDurationMs?: number | null;
  lastOutcome?: 'success' | 'failure' | null;
  lastValidationPassed?: boolean | null;
};

export type ToolCheck = {
  id: string;
  checkedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  statusCode: number | null;
  errorCode: string | null;
  sanitizedError: string | null;
  validationPassed: boolean;
  validationMessage: string | null;
};

/**
 * Administrative operations (register a server, manual check, tool discovery,
 * tool test, delete) are authorized with an administrative key that is sent
 * in the X-MCPulse-Admin-Key header. The key is kept in the browser only, so
 * the dashboard works from any network address.
 */
const ADMIN_KEY_STORAGE = 'mcpulse-admin-key';

/**
 * The key that was compiled into the bundle (see the VITE_ADMIN_KEY build
 * argument). It allows the dashboard to authorize its write operations on its
 * own. A key that the operator types in the browser always takes precedence.
 */
const BUILT_IN_ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY as string | undefined) ?? '';

export const getAdminKey = (): string => {
  try {
    const stored = localStorage.getItem(ADMIN_KEY_STORAGE);
    if (stored) return stored;
  } catch {
    /* storage is unavailable */
  }
  return BUILT_IN_ADMIN_KEY;
};

export const setAdminKey = (key: string) => {
  try {
    if (key) localStorage.setItem(ADMIN_KEY_STORAGE, key);
    else localStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* storage is unavailable, the key is simply not remembered */
  }
};

/**
 * Raised when the API rejects a state changing operation because the
 * administrative key is missing or wrong. The dashboard reacts by opening the
 * key editor instead of showing a raw error.
 */
export class AdminKeyRequiredError extends Error {
  constructor() {
    super(
      'The administrative key is missing or incorrect. Enter it with the "Set admin key" button in the header.',
    );
    this.name = 'AdminKeyRequiredError';
  }
}

/** Dispatched so the header can open the key editor automatically. */
export const ADMIN_KEY_REQUIRED_EVENT = 'mcpulse:admin-key-required';

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== 'GET' && method !== 'HEAD') {
    const key = getAdminKey();
    if (key) headers.set('X-MCPulse-Admin-Key', key);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(ADMIN_KEY_REQUIRED_EVENT));
    throw new AdminKeyRequiredError();
  }

  if (!response.ok) {
    let msg = `Request failed (${response.status})`;
    try {
      const errJson = (await response.json()) as { error?: string };
      if (errJson.error) msg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return response.json() as Promise<T>;
};

export type CreateServerPayload = {
  name: string;
  endpoint: string;
  transportType: 'streamable_http';
  enabled: boolean;
  checkIntervalSeconds: number;
};

export const api = {
  dashboard: () => request<DashboardSummary>('/api/dashboard/summary'),
  checks: (serverId: string) =>
    request<{ checks: Check[] }>(`/api/servers/${serverId}/checks?limit=50`),
  checkNow: (serverId: string) =>
    request(`/api/servers/${serverId}/check-now`, { method: 'POST' }),
  createServer: (payload: CreateServerPayload) =>
    request('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteServer: (serverId: string) =>
    request(`/api/servers/${serverId}`, { method: 'DELETE' }),

  // Tool discovery & testing
  discoverTools: (serverId: string) =>
    request<{ durationMs: number; count: number; tools: McpTool[] }>(
      `/api/servers/${serverId}/discover-tools`,
      { method: 'POST' },
    ),
  getTools: (serverId: string) =>
    request<{ tools: McpTool[] }>(`/api/servers/${serverId}/tools`),
  testTool: (
    toolId: string,
    params: Record<string, unknown> = {},
    validationRules: Array<{ field?: string; operator?: string; value?: unknown }> = [],
  ) =>
    request<ToolCheck & { responseSummary?: Record<string, unknown> }>(
      `/api/tools/${toolId}/test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params, validationRules }),
      },
    ),
  getToolChecks: (toolId: string) =>
    request<{ checks: ToolCheck[] }>(`/api/tools/${toolId}/checks`),

  // Evidence-based AI Diagnostic Report
  getAiAnalysis: (serverId: string) =>
    request<{
      serverName: string;
      endpoint: string;
      analyzedAt: string;
      observedFacts: string[];
      hypotheses: string[];
      recommendations: string[];
    }>(`/api/analysis/${serverId}`),
};
