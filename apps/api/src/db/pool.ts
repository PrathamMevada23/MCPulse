import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { env } from '../config/env.js';

let pool: Pool | undefined;

/**
 * Extracts the host portion of a PostgreSQL connection string without
 * re-encoding it. The URL class would percent-encode special characters in
 * the password, which would silently change the credentials.
 */
const hostnameOf = (rawUrl: string) => {
  const authority = /^postgres(?:ql)?:\/\/([^/?#]+)/i.exec(rawUrl)?.[1] ?? '';
  const hostAndPort = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  return hostAndPort.split(':')[0].toLowerCase();
};

const isAmazonRdsHost = (rawUrl: string) =>
  hostnameOf(rawUrl).endsWith('.rds.amazonaws.com');

/**
 * Loads a CA bundle from disk. Amazon RDS uses the published global bundle,
 * a containerised PostgreSQL uses the locally generated certificate authority.
 */
const loadCaBundle = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read the CA bundle at ${path}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
};

/**
 * `pg` rebuilds the `ssl` option from the connection string query parameters
 * (via pg-connection-string), which silently discards an explicit `ssl`
 * object passed to the Pool. Every TLS related parameter is therefore removed
 * here so the verified TLS configuration below is the only one in effect.
 */
const stripTlsParameters = (rawUrl: string) => {
  const queryStart = rawUrl.indexOf('?');
  if (queryStart === -1) return rawUrl;

  const base = rawUrl.slice(0, queryStart);
  const query = rawUrl.slice(queryStart + 1);
  const kept = query
    .split('&')
    .filter((pair) => pair.length > 0)
    .filter((pair) => {
      const key = pair.split('=', 1)[0].toLowerCase();
      return !(
        key === 'ssl' ||
        key === 'sslmode' ||
        key === 'sslrootcert' ||
        key === 'sslcert' ||
        key === 'sslkey'
      );
    });

  return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
};

const loadRdsCaBundle = () => {
  if (!env.RDS_CA_BUNDLE_PATH) {
    throw new Error(
      'RDS_CA_BUNDLE_PATH is required to connect to Amazon RDS with verified TLS.',
    );
  }
  return loadCaBundle(env.RDS_CA_BUNDLE_PATH);
};

/**
 * Builds the TLS options for the pool, or returns undefined when the database
 * is a plain local socket without a certificate authority.
 */
const tlsOptions = () => {
  if (!env.DATABASE_URL) return undefined;
  if (isAmazonRdsHost(env.DATABASE_URL)) {
    return { ca: loadRdsCaBundle(), rejectUnauthorized: true };
  }
  if (env.DATABASE_TLS_CA_PATH) {
    return {
      ca: loadCaBundle(env.DATABASE_TLS_CA_PATH),
      rejectUnauthorized: true,
    };
  }
  return undefined;
};

export const getPool = () => {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for database-backed routes.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: stripTlsParameters(env.DATABASE_URL),
      // TLS is enabled whenever a CA bundle is available: Amazon RDS uses the
      // published global bundle, a containerised PostgreSQL uses the locally
      // generated certificate authority. The certificate chain and the
      // hostname are always verified.
      ...(tlsOptions() ? { ssl: tlsOptions() } : {}),
      connectionTimeoutMillis: 10_000,
      max: 10,
    });
  }
  return pool;
};

export const isAmazonRdsConnection = (rawUrl: string) =>
  isAmazonRdsHost(rawUrl);
