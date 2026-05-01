import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAdminNames } from '../auth.js';
import { validateSubscriptionBody } from '../routes-push.js';

// Header reflects the real Users tab. Only B/E/F are read by findAdminNames.
const HEADER = [
  'Username', 'FullName', 'Department', 'Role', 'AccessLevel', 'Active',
  'G', 'H', 'I', 'J', 'K', 'PIN', 'Email',
];

function makeRow({ name = '', accessLevel = 'User', active = 'TRUE', pin = '' } = {}) {
  return ['', name, '', '', accessLevel, active, '', '', '', '', '', pin, ''];
}

// ---- findAdminNames --------------------------------------------------------

test('findAdminNames returns active Admin FullNames only', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'Alice', accessLevel: 'Admin', active: 'TRUE' }),
    makeRow({ name: 'Bob', accessLevel: 'User', active: 'TRUE' }),
    makeRow({ name: 'Carol', accessLevel: 'Admin', active: 'TRUE' }),
  ];
  assert.deepEqual(findAdminNames(rows), ['Alice', 'Carol']);
});

test('findAdminNames skips inactive Admins', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'Alice', accessLevel: 'Admin', active: 'TRUE' }),
    makeRow({ name: 'Dan', accessLevel: 'Admin', active: 'FALSE' }),
  ];
  assert.deepEqual(findAdminNames(rows), ['Alice']);
});

test('findAdminNames returns [] for empty/missing rows', () => {
  assert.deepEqual(findAdminNames([]), []);
  assert.deepEqual(findAdminNames(null), []);
  assert.deepEqual(findAdminNames(undefined), []);
});

test('findAdminNames trims whitespace from FullName', () => {
  const rows = [
    HEADER,
    makeRow({ name: '  Eve  ', accessLevel: 'Admin', active: 'TRUE' }),
  ];
  assert.deepEqual(findAdminNames(rows), ['Eve']);
});

test('findAdminNames skips rows with empty FullName', () => {
  const rows = [
    HEADER,
    makeRow({ name: '', accessLevel: 'Admin', active: 'TRUE' }),
    makeRow({ name: 'Frank', accessLevel: 'Admin', active: 'TRUE' }),
  ];
  assert.deepEqual(findAdminNames(rows), ['Frank']);
});

test('findAdminNames is case-insensitive on Active flag', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'Alice', accessLevel: 'Admin', active: 'true' }),
  ];
  assert.deepEqual(findAdminNames(rows), ['Alice']);
});

// ---- validateSubscriptionBody ---------------------------------------------

const VALID_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BNc...long-base64...', auth: 'auth-secret' },
};

test('validateSubscriptionBody accepts a well-formed body', () => {
  const r = validateSubscriptionBody({
    subscription: VALID_SUB,
    user_agent: 'Mozilla/5.0',
  });
  assert.equal(r.ok, true);
  assert.equal(r.sub.endpoint, VALID_SUB.endpoint);
  assert.equal(r.sub.p256dh, 'BNc...long-base64...');
  assert.equal(r.sub.auth, 'auth-secret');
  assert.equal(r.sub.userAgent, 'Mozilla/5.0');
});

test('validateSubscriptionBody rejects missing subscription', () => {
  const r = validateSubscriptionBody({});
  assert.deepEqual(r, { ok: false, error: 'INVALID_SUBSCRIPTION' });
});

test('validateSubscriptionBody rejects null body', () => {
  const r = validateSubscriptionBody(null);
  assert.deepEqual(r, { ok: false, error: 'INVALID_SUBSCRIPTION' });
});

test('validateSubscriptionBody rejects non-http endpoint', () => {
  const r = validateSubscriptionBody({
    subscription: { ...VALID_SUB, endpoint: 'javascript:alert(1)' },
  });
  assert.deepEqual(r, { ok: false, error: 'INVALID_ENDPOINT' });
});

test('validateSubscriptionBody rejects empty endpoint', () => {
  const r = validateSubscriptionBody({
    subscription: { ...VALID_SUB, endpoint: '' },
  });
  assert.deepEqual(r, { ok: false, error: 'INVALID_ENDPOINT' });
});

test('validateSubscriptionBody rejects missing keys.p256dh', () => {
  const r = validateSubscriptionBody({
    subscription: { ...VALID_SUB, keys: { auth: 'auth-secret' } },
  });
  assert.deepEqual(r, { ok: false, error: 'MISSING_KEYS' });
});

test('validateSubscriptionBody rejects missing keys.auth', () => {
  const r = validateSubscriptionBody({
    subscription: { ...VALID_SUB, keys: { p256dh: 'pk' } },
  });
  assert.deepEqual(r, { ok: false, error: 'MISSING_KEYS' });
});

test('validateSubscriptionBody trims user_agent and caps at 500 chars', () => {
  const long = 'x'.repeat(800);
  const r = validateSubscriptionBody({
    subscription: VALID_SUB,
    user_agent: `  ${long}  `,
  });
  assert.equal(r.ok, true);
  assert.equal(r.sub.userAgent.length, 500);
});

test('validateSubscriptionBody handles missing user_agent', () => {
  const r = validateSubscriptionBody({ subscription: VALID_SUB });
  assert.equal(r.ok, true);
  assert.equal(r.sub.userAgent, '');
});
