import crypto from 'node:crypto';

// Format: scrypt$<N>$<salt b64>$<hash b64>
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function isHash(s) {
  return typeof s === 'string' && /^scrypt\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(s);
}

export function verifyPassword(password, stored) {
  if (!isHash(stored)) return false;
  const [, n, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: R, p: P });
  return crypto.timingSafeEqual(expected, actual);
}
