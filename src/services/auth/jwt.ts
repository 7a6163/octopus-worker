/**
 * JWT 認證服務
 * 使用 Web Crypto API 實作 JWT 簽發與驗證
 *
 * 功能：
 * - JWT Token 簽發
 * - JWT Token 驗證
 * - Token 刷新
 */

/**
 * JWT Payload 介面
 */
export interface JWTPayload {
  userId: number;
  username: string;
  role: 'admin' | 'user';
  iat: number; // Issued At
  exp: number; // Expiration Time
}

/**
 * JWT 配置
 */
interface JWTConfig {
  secret: string;
  expiresIn: number; // 秒
}

/**
 * Base64URL 編碼
 */
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL 解碼
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // 補齊 padding
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

/**
 * 使用 HMAC-SHA256 簽名
 */
async function sign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  // 導入 HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 簽名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 轉換為 base64url
  const signatureArray = Array.from(new Uint8Array(signature));
  const signatureString = String.fromCharCode(...signatureArray);
  return base64UrlEncode(signatureString);
}

/**
 * 簽發 JWT Token
 */
export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  config: JWTConfig
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // 完整的 payload
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

  // 編碼 header 和 payload
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload));

  // 簽名
  const message = `${headerEncoded}.${payloadEncoded}`;
  const signature = await sign(message, config.secret);

  // 組合 JWT
  return `${message}.${signature}`;
}

/**
 * 驗證 JWT Token
 */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  // 分割 token
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerEncoded, payloadEncoded, signature] = parts;

  // 驗證簽名
  const message = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = await sign(message, secret);

  if (signature !== expectedSignature) {
    throw new Error('Invalid JWT signature');
  }

  // 解碼 payload
  const payloadString = base64UrlDecode(payloadEncoded!);
  const payload = JSON.parse(payloadString) as JWTPayload;

  // 驗證過期時間
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('JWT token expired');
  }

  return payload;
}

/**
 * 刷新 Token
 * 檢查舊 token 是否即將過期（剩餘時間 < 1 小時），如果是則簽發新 token
 */
export async function refreshToken(
  oldToken: string,
  config: JWTConfig
): Promise<{ token: string; refreshed: boolean }> {
  try {
    // 驗證舊 token
    const payload = await verifyJWT(oldToken, config.secret);

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = payload.exp - now;

    // 如果剩餘時間 > 1 小時，不需要刷新
    if (timeRemaining > 3600) {
      return { token: oldToken, refreshed: false };
    }

    // 簽發新 token
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
 * 從 Authorization Header 提取 Token
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
