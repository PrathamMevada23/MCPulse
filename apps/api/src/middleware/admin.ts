import type { RequestHandler } from 'express';
import { env } from '../config/env.js';

/**
 * Administrative authorization.
 *
 * Read-only operations (dashboard, check history, tool inventory, diagnostics,
 * CSV export) stay public. Every state changing operation requires the
 * administrative key when ADMIN_API_KEY is configured.
 *
 * The key is sent in the X-MCPulse-Admin-Key header. A network allowlist on
 * its own is not enough: the address of a campus or corporate network changes
 * regularly, which would either lock the operator out or force a wide open
 * range.
 */
export const requireAdmin: RequestHandler = (request, response, next) => {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return next();
  }

  if (!env.ADMIN_API_KEY) return next();

  const provided = request.get('x-mcpulse-admin-key');
  if (provided && provided === env.ADMIN_API_KEY) return next();

  return response.status(401).json({
    error:
      'This operation requires the administrative key. Send it in the X-MCPulse-Admin-Key header.',
  });
};
