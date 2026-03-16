/**
 * URL validation utilities for SSRF protection.
 *
 * Rejects private/loopback/internal addresses to prevent
 * server-side request forgery attacks.
 */

export interface UrlValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

const PRIVATE_HOST_PATTERNS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'] as const;

const PRIVATE_HOST_PREFIXES = [
  '10.',
  '192.168.',
  '169.254.', // link-local / cloud metadata
] as const;

const PRIVATE_HOST_SUFFIXES = ['.internal', '.local'] as const;

/** IPv6 prefixes that indicate private/link-local addresses */
const PRIVATE_IPV6_PREFIXES = ['fc', 'fd', 'fe80'] as const;

/**
 * Check whether a 172.x.y.z address falls in the private range 172.16.0.0 - 172.31.255.255.
 */
function isPrivate172(host: string): boolean {
  if (!host.startsWith('172.')) return false;
  const secondOctet = parseInt(host.split('.')[1] ?? '', 10);
  return secondOctet >= 16 && secondOctet <= 31;
}

/**
 * Check whether the host falls in the carrier-grade NAT range 100.64.0.0 - 100.127.255.255.
 */
function isCarrierGradeNat(host: string): boolean {
  if (!host.startsWith('100.')) return false;
  const secondOctet = parseInt(host.split('.')[1] ?? '', 10);
  return secondOctet >= 64 && secondOctet <= 127;
}

/**
 * Check whether the host is a private IPv6 address (fc00::/7, fe80::/10).
 * Handles bracketed IPv6 notation (e.g. [::1]).
 */
function isPrivateIpv6(host: string): boolean {
  const stripped = host.replace(/^\[|\]$/g, '');
  return PRIVATE_IPV6_PREFIXES.some((prefix) => stripped.startsWith(prefix));
}

const BLOCKED_MSG = 'Private/internal URLs are not allowed';

/**
 * Validate that a URL is safe for outbound requests.
 * Rejects non-HTTP(S) protocols and private/internal addresses.
 */
export function validateOutboundUrl(rawUrl: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'Only http/https URLs are allowed' };
  }

  const host = parsed.hostname.toLowerCase();

  if ((PRIVATE_HOST_PATTERNS as readonly string[]).includes(host)) {
    return { valid: false, error: BLOCKED_MSG };
  }

  for (const prefix of PRIVATE_HOST_PREFIXES) {
    if (host.startsWith(prefix)) {
      return { valid: false, error: BLOCKED_MSG };
    }
  }

  if (isPrivate172(host)) {
    return { valid: false, error: BLOCKED_MSG };
  }

  if (isCarrierGradeNat(host)) {
    return { valid: false, error: BLOCKED_MSG };
  }

  if (isPrivateIpv6(host)) {
    return { valid: false, error: BLOCKED_MSG };
  }

  for (const suffix of PRIVATE_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return { valid: false, error: BLOCKED_MSG };
    }
  }

  return { valid: true };
}
