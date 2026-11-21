const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-only-secret-with-more-than-thirty-two-characters';
const auth = require('../server/auth');

test('password hashes verify only the correct password', () => {
  const stored = auth.hashPassword('a-strong-test-password');
  assert.equal(auth.verifyPassword('a-strong-test-password', stored), true);
  assert.equal(auth.verifyPassword('wrong-password', stored), false);
});

test('signed tokens verify and preserve claims', () => {
  const token = auth.createToken({ id: 'user-1', role: 'fleet_manager', company_id: 'company-1' });
  const claims = auth.verifyToken(token);
  assert.equal(claims.id, 'user-1');
  assert.equal(claims.company_id, 'company-1');
});

test('invalid tokens are rejected', () => {
  assert.equal(auth.verifyToken('not-a-token'), null);
  assert.equal(auth.verifyToken('a.b.c'), null);
});

test('tokens cannot be created without a strong configured secret', () => {
  const original = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  assert.throws(() => auth.createToken({ id: 'user-1' }), /JWT_SECRET/);
  process.env.JWT_SECRET = original;
});
