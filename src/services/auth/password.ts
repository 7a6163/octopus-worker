/**
 * Password hashing utilities
 * Uses PBKDF2 for password hashing (Web Crypto API)
 */

const encoder = new TextEncoder();

/**
 * Generate a random salt
 */
function generateSalt(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash password using PBKDF2
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
 * Hash a password
 * Returns format: salt:hash
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const hash = await pbkdf2Hash(password, salt);
  return `${salt}:${hash}`;
}

/**
 * Verify a password
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  const [salt, hash] = hashedPassword.split(':');
  if (!salt || !hash) {
    return false;
  }

  const computedHash = await pbkdf2Hash(password, salt);
  return computedHash === hash;
}
