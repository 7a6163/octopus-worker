/**
 * Password hashing utilities
 * 使用 PBKDF2 進行密碼雜湊 (Web Crypto API)
 */

const encoder = new TextEncoder();

/**
 * 生成隨機 salt
 */
function generateSalt(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 使用 PBKDF2 雜湊密碼
 */
async function pbkdf2Hash(password: string, salt: string): Promise<string> {
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = encoder.encode(salt);

  const key = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, [
    'deriveBits',
  ]);

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256
  );

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 雜湊密碼
 * 返回格式: salt:hash
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const hash = await pbkdf2Hash(password, salt);
  return `${salt}:${hash}`;
}

/**
 * 驗證密碼
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  const [salt, hash] = hashedPassword.split(':');
  if (!salt || !hash) {
    return false;
  }

  const computedHash = await pbkdf2Hash(password, salt);
  return computedHash === hash;
}
