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
  return constantTimeEqual(computedHash, hash);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * XORs all bytes and checks the result is zero.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do work to avoid leaking length difference via timing
    // Compare a against itself to burn equivalent CPU time
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ a.charCodeAt(0);
    }
    // Always return false for length mismatch; use dummy to prevent dead code elimination
    return dummy < 0 && dummy > 0;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
