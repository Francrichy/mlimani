/**
 * Auth helpers — scrypt password hashing + HMAC tokens (no external deps)
 */
const crypto = require('crypto');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters');
  }
  return secret;
}
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const storedHash = Buffer.from(hash, 'hex');
  const testHash = Buffer.from(test, 'hex');
  return storedHash.length === testHash.length && crypto.timingSafeEqual(storedHash, testHash);
}

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', getJwtSecret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  let expected;
  try {
    expected = crypto.createHmac('sha256', getJwtSecret()).update(`${header}.${body}`).digest('base64url');
  } catch {
    return null;
  }
  const supplied = Buffer.from(sig);
  const calculated = Buffer.from(expected);
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}


/** Normalize TZ mobile to 255XXXXXXXXX */
function normalizePhone(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0') && p.length === 10) p = '255' + p.slice(1);
  if (p.startsWith('255') && p.length === 12) return p;
  return p;
}

function isPhoneLike(value) {
  const v = String(value || '').replace(/[\s\-()]/g, '');
  return /^(\+?255|0)?[67]\d{8}$/.test(v) || /^255[67]\d{8}$/.test(v);
}

module.exports = { hashPassword, verifyPassword, createToken, verifyToken, normalizePhone, isPhoneLike };

