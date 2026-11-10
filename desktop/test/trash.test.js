'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../renderer/trash-logic');

const NOW = 1_700_000_000_000;
const M = 60000, H = 3600000, D = 86400000;

test('relativeTime buckets', () => {
  assert.strictEqual(T.relativeTime(NOW - 5000, NOW), 'just now');
  assert.strictEqual(T.relativeTime(NOW + 5000, NOW), 'just now');
  assert.strictEqual(T.relativeTime(NOW - M, NOW), '1 minute ago');
  assert.strictEqual(T.relativeTime(NOW - 5 * M, NOW), '5 minutes ago');
  assert.strictEqual(T.relativeTime(NOW - 3 * H, NOW), '3 hours ago');
  assert.strictEqual(T.relativeTime(NOW - 30 * H, NOW), 'yesterday');
  assert.strictEqual(T.relativeTime(NOW - 12 * D, NOW), '12 days ago');
  assert.strictEqual(T.relativeTime(undefined, NOW), '');
});

test('daysLeft rounds up and handles no expiry', () => {
  assert.strictEqual(T.daysLeft(NOW + 23 * H, NOW), 1);
  assert.strictEqual(T.daysLeft(NOW + 30 * D, NOW), 30);
  assert.strictEqual(T.daysLeft(NOW - D, NOW), 0);
  assert.strictEqual(T.daysLeft(null, NOW), null);
  assert.strictEqual(T.daysLeftText(1), 'Deletes in 1 day');
  assert.strictEqual(T.daysLeftText(5), 'Deletes in 5 days');
  assert.strictEqual(T.daysLeftText(0), 'Deletes today');
  assert.strictEqual(T.daysLeftText(null), 'Kept until you delete it');
});

test('originalFolder', () => {
  assert.strictEqual(T.originalFolder('a/b/c.txt'), '/a/b');
  assert.strictEqual(T.originalFolder('c.txt'), '/');
  assert.strictEqual(T.originalFolder('/x/y'), '/x');
  assert.strictEqual(T.originalFolder(undefined), '');
  assert.strictEqual(T.originalFolder(''), '');
});

test('rowModel flags urgent at 3 days or less', () => {
  const base = { id: 'i1', name: 'n.txt', isDir: false, size: 2048, deletedAt: NOW - 2 * H, originalPath: 'docs/n.txt' };
  const a = T.rowModel({ ...base, expiresAt: NOW + 3 * D }, NOW);
  assert.strictEqual(a.urgent, true);
  assert.strictEqual(a.leftText, 'Deletes in 3 days');
  assert.strictEqual(a.deletedText, 'Deleted 2 hours ago');
  assert.strictEqual(a.folder, '/docs');
  assert.strictEqual(a.size, 2048);
  const b = T.rowModel({ ...base, expiresAt: NOW + 4 * D - H }, NOW);
  assert.strictEqual(b.urgent, false);
  const c = T.rowModel({ ...base, expiresAt: NOW + 20 * D, isDir: true, originalPath: undefined }, NOW);
  assert.strictEqual(c.isDir, true);
  assert.strictEqual(c.size, null);
  assert.strictEqual(c.folder, '');
  assert.strictEqual(T.rowModel({ ...base, expiresAt: null }, NOW).urgent, false);
});

test('headerText uses the days value', () => {
  assert.strictEqual(T.headerText(30), 'Files are removed permanently after 30 days');
  assert.strictEqual(T.headerText(7), 'Files are removed permanently after 7 days');
  assert.strictEqual(T.headerText(0), 'Files stay here until you delete them');
});
