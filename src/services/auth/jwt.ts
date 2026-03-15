/**
 * JWT authentication service
 * Implements JWT signing and verification using Web Crypto API
 *
 * Features:
 * - JWT token signing
 * - JWT token verification
 * - Token refresh
 */

/**
 * JWT Payload interface
 */
export interface JWTPayload {
  userId: number;
  username: string;
  role: 'admin' | 'user';
  iat: number; // Issued At
  exp: number; // Expiration Time
}

/**
 * JWT configuration
 */
interface JWTConfig {
  secret: string;
  expiresIn: number; // seconds
}

/**
 * Base64URL encode
 */
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to correct length
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

/**
 * Sign with HMAC-SHA256
 */
async function sign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  // Import HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // Convert to base64url
  const signatureArray = Array.from(new Uint8Array(signature));
  const signatureString = String.fromCharCode(...signatureArray);
  return base64UrlEncode(signatureString);
}

/**
 * Sign a JWT token
 */
export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  config: JWTConfig
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Build full payload
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + config.expiresIn,
  };

  // JWT Header
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  // Encode header and payload
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload));

  // Sign
  const message = `${headerEncoded}.${payloadEncoded}`;
  const signature = await sign(message, config.secret);

  // Assemble JWT
  return `${message}.${signature}`;
}

/**
 * Verify a JWT token
 */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  // Split token
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerEncoded, payloadEncoded, signature] = parts;

  // Verify signature
  const message = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = await sign(message, secret);

  if (signature !== expectedSignature) {
    throw new Error('Invalid JWT signature');
  }

  // Decode payload
  const payloadString = base64UrlDecode(payloadEncoded!);
  const payload = JSON.parse(payloadString) as JWTPayload;

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('JWT token expired');
  }

  return payload;
}

/**
 * Refresh token
 * Checks if the old token is about to expire (remaining time < 1 hour); if so, issues a new token
 */
export async function refreshToken(
  oldToken: string,
  config: JWTConfig
): Promise<{ token: string; refreshed: boolean }> {
  try {
    // Verify old token
    const payload = await verifyJWT(oldToken, config.secret);

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = payload.exp - now;

    // If remaining time > 1 hour, no refresh needed
    if (timeRemaining > 3600) {
      return { token: oldToken, refreshed: false };
    }

    // Issue new token
    const newToken = await signJWT(
      {
        userId: payload.userId,
        username: payload.username,
        role: payload.role,
      },
      config
    );

    return { token: newToken, refreshed: true };
  } catch (err) {
    throw new Error(`Token refresh failed: ${(err as Error).message}`);
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] || null;
}
