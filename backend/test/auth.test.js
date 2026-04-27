import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUserByPin } from '../auth.js';

// Header reflects the real Users tab. Only B/E/F/L/M are read by auth.
const HEADER = [
  'Username', 'FullName', 'Department', 'Role', 'AccessLevel', 'Active',
  'G', 'H', 'I', 'J', 'K', 'PIN', 'Email',
];

function makeRow({ username = '', name = '', dept = '', jobRole = '', accessLevel = 'User', active = 'TRUE', pin = '', email = '' } = {}) {
  return [username, name, dept, jobRole, accessLevel, active, '', '', '', '', '', pin, email];
}

test('returns ok with name/email/role for valid active User', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'Rachael Schofield', accessLevel: 'User', active: 'TRUE', pin: '1234', email: 'rachael@rac.com' }),
  ];
  const result = findUserByPin(rows, '1234');
  assert.equal(result.ok, true);
  assert.equal(result.name, 'Rachael Schofield');
  assert.equal(result.email, 'rachael@rac.com');
  assert.equal(result.role, 'User');
});

test('returns ok with role Admin for Admin user', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'Duane Kuru', accessLevel: 'Admin', active: 'TRUE', pin: '7777', email: 'duane@rac.com' }),
  ];
  const result = findUserByPin(rows, '7777');
  assert.equal(result.ok, true);
  assert.equal(result.role, 'Admin');
});

test('returns INVALID_PIN when no row matches', () => {
  const rows = [
    HEADER,
    makeRow({ pin: '1234', active: 'TRUE' }),
  ];
  const result = findUserByPin(rows, '9999');
  assert.deepEqual(result, { ok: false, error: 'INVALID_PIN' });
});

test('returns INACTIVE_USER when Active is FALSE', () => {
  const rows = [
    HEADER,
    makeRow({ pin: '5555', active: 'FALSE', name: 'Inactive Person' }),
  ];
  const result = findUserByPin(rows, '5555');
  assert.deepEqual(result, { ok: false, error: 'INACTIVE_USER' });
});

test('returns INACTIVE_USER when Active cell is empty', () => {
  const rows = [
    HEADER,
    makeRow({ pin: '5555', active: '', name: 'Empty Active' }),
  ];
  const result = findUserByPin(rows, '5555');
  assert.deepEqual(result, { ok: false, error: 'INACTIVE_USER' });
});

test('returns ok with empty email when Email column is missing from row', () => {
  // Row deliberately shorter than 13 columns — Email cell never written
  const shortRow = ['x', 'Duane', '', '', 'Admin', 'TRUE', '', '', '', '', '', '7777'];
  const rows = [HEADER, shortRow];
  const result = findUserByPin(rows, '7777');
  assert.equal(result.ok, true);
  assert.equal(result.email, '');
  assert.equal(result.name, 'Duane');
  assert.equal(result.role, 'Admin');
});

test('returns ok with empty email when Email cell is empty string', () => {
  const rows = [
    HEADER,
    makeRow({ pin: '4321', accessLevel: 'User', active: 'TRUE', name: 'No Email', email: '' }),
  ];
  const result = findUserByPin(rows, '4321');
  assert.equal(result.ok, true);
  assert.equal(result.email, '');
});

test('finds the correct user among many rows', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'A', accessLevel: 'User', active: 'TRUE', pin: '1111' }),
    makeRow({ name: 'B', accessLevel: 'User', active: 'TRUE', pin: '2222' }),
    makeRow({ name: 'C', accessLevel: 'Admin', active: 'TRUE', pin: '3333' }),
  ];
  const result = findUserByPin(rows, '2222');
  assert.equal(result.ok, true);
  assert.equal(result.name, 'B');
});

test('PIN comparison trims whitespace from sheet value', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'Padded', accessLevel: 'User', active: 'TRUE', pin: '  1234  ', email: 'p@x' }),
  ];
  const result = findUserByPin(rows, '1234');
  assert.equal(result.ok, true);
  assert.equal(result.name, 'Padded');
});

test('Active comparison is case-insensitive', () => {
  const rows = [
    HEADER,
    makeRow({ name: 'Lower True', accessLevel: 'User', active: 'true', pin: '8888' }),
  ];
  const result = findUserByPin(rows, '8888');
  assert.equal(result.ok, true);
});

test('returns INVALID_PIN on empty sheet (header only)', () => {
  const rows = [HEADER];
  const result = findUserByPin(rows, '1234');
  assert.deepEqual(result, { ok: false, error: 'INVALID_PIN' });
});

test('returns INVALID_PIN when rows is not an array', () => {
  const result = findUserByPin(null, '1234');
  assert.deepEqual(result, { ok: false, error: 'INVALID_PIN' });
});

test('skips header row when finding by PIN', () => {
  // Header itself contains the string "PIN" in column L. Make sure we don't match it.
  const rows = [HEADER];
  const result = findUserByPin(rows, 'PIN');
  assert.deepEqual(result, { ok: false, error: 'INVALID_PIN' });
});
