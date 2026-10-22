import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env'),
});

/**
 * An environment variable that is present but empty means "not configured".
 * Compose files pass empty values for optional paths, which must not fail the
 * schema validation.
 */
const optionalPath = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  );

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default('127.0.0.1'),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional(),
  /**
   * Absolute path to the Amazon RDS CA bundle (global-bundle.pem) inside the
   * container. Required whenever the database host is an RDS endpoint: TLS is
   * then verified against this CA and the certificate hostname is checked.
   */
  RDS_CA_BUNDLE_PATH: optionalPath(),
  /**
   * Absolute path to a CA bundle for a non-RDS database (for example the
   * certificate authority of a containerised PostgreSQL). When set, the
   * connection is encrypted and the certificate is verified.
   */
  DATABASE_TLS_CA_PATH: optionalPath(),
  /**
   * Optional shared secret required by management routes (manual check,
   * outage simulation, server deletion). When unset the routes stay open, so
   * it must only be used together with a network-level restriction.
   */
  ADMIN_API_KEY: optionalPath(),
  CHECK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  INCIDENT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
});

export const env = environmentSchema.parse(process.env);
