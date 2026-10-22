import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Hostnames that resolve to cloud instance metadata services. */
const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
]);

const isLoopbackIpv4 = (parts: number[]) => parts[0] === 127;

const isPrivateIpv4 = (parts: number[]) => {
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  // Carrier grade NAT and benchmarking ranges are not public destinations.
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
  return false;
};

const isLinkLocalIpv4 = (parts: number[]) =>
  parts[0] === 169 && parts[1] === 254;

const isUnspecifiedIpv4 = (parts: number[]) => parts[0] === 0;

const classifyIpv6 = (hostname: string) => {
  const address = hostname.toLowerCase().split('%')[0];
  if (address === '::1' || address === '::') return 'loopback';
  if (address.startsWith('fe80')) return 'link-local';
  // Unique local addresses (fc00::/7) and IPv4-mapped private ranges.
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return 'private';
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length);
    if (isIP(mapped) === 4) {
      const parts = mapped.split('.').map(Number);
      if (isLoopbackIpv4(parts)) return 'loopback';
      if (isPrivateIpv4(parts)) return 'private';
      if (isLinkLocalIpv4(parts)) return 'link-local';
    }
  }
  return null;
};

/**
 * Validates a URL against Server-Side Request Forgery (SSRF).
 * Blocks loopback, private ranges, link-local, and cloud metadata endpoints.
 *
 * This check is deliberately free of DNS lookups so it can run on every
 * outbound request without adding latency or flakiness.
 */
export const validateSafeRemoteUrl = (
  rawUrl: string,
): { safe: boolean; reason?: string } => {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { safe: false, reason: 'Only http and https protocols are supported' };
    }

    // `new URL()` keeps IPv6 literals in brackets ("[::1]"), which Node's
    // isIP() does not recognise, so they are stripped first.
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Check prohibited hostnames
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      return { safe: false, reason: 'Loopback and internal domains are prohibited' };
    }

    if (METADATA_HOSTNAMES.has(hostname)) {
      return { safe: false, reason: 'Cloud metadata endpoints are prohibited' };
    }

    // IP address checks
    const ipVersion = isIP(hostname);
    if (ipVersion !== 0) {
      // IPv4 checks
      if (ipVersion === 4) {
        const parts = hostname.split('.').map(Number);
        // 127.0.0.0/8 (loopback)
        if (isLoopbackIpv4(parts))
          return { safe: false, reason: 'Loopback IP is prohibited' };
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (private)
        if (isPrivateIpv4(parts))
          return { safe: false, reason: 'Private IP space is prohibited' };
        // 169.254.0.0/16 (link-local & AWS metadata)
        if (isLinkLocalIpv4(parts))
          return {
            safe: false,
            reason: 'Link-local/cloud metadata IP is prohibited',
          };
        // 0.0.0.0
        if (isUnspecifiedIpv4(parts))
          return { safe: false, reason: 'Prohibited IP address' };
      }

      // IPv6 checks
      if (ipVersion === 6) {
        const classification = classifyIpv6(hostname);
        if (classification === 'loopback')
          return { safe: false, reason: 'IPv6 loopback is prohibited' };
        if (classification === 'link-local')
          return {
            safe: false,
            reason: 'IPv6 link-local is prohibited',
          };
        if (classification === 'private')
          return { safe: false, reason: 'IPv6 private address is prohibited' };
      }
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }
};

/**
 * Resolves a hostname and verifies that every address it points to is a public
 * destination. This closes the gap left by {@link validateSafeRemoteUrl}, which
 * can only inspect literal IP addresses.
 */
export const validateResolvedDestination = async (
  rawUrl: string,
): Promise<{ safe: boolean; reason?: string }> => {
  const literal = validateSafeRemoteUrl(rawUrl);
  if (!literal.safe) return literal;

  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  if (isIP(hostname) !== 0) return { safe: true };

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    // DNS failure: the request itself will fail and be recorded as a check
    // error. It is not treated as an SSRF violation.
    return { safe: true };
  }

  for (const entry of addresses) {
    const ip = entry.address.toLowerCase();
    if (isIP(ip) === 4) {
      const parts = ip.split('.').map(Number);
      if (isLoopbackIpv4(parts))
        return { safe: false, reason: 'Hostname resolves to a loopback address' };
      if (isPrivateIpv4(parts))
        return { safe: false, reason: 'Hostname resolves to a private address' };
      if (isLinkLocalIpv4(parts))
        return {
          safe: false,
          reason: 'Hostname resolves to a link-local/metadata address',
        };
      if (isUnspecifiedIpv4(parts))
        return { safe: false, reason: 'Hostname resolves to an unspecified address' };
    } else if (isIP(ip) === 6) {
      const classification = classifyIpv6(ip);
      if (classification)
        return {
          safe: false,
          reason: `Hostname resolves to a ${classification} address`,
        };
    }
  }

  return { safe: true };
};
