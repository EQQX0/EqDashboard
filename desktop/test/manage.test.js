'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { createApi, allowedPath } = require('../api');
const M = require('../renderer/manage-logic');

test('allowlist covers the new VPS, PC, files and agent endpoints and nothing wider', () => {
  for (const p of ['vps/create', 'vps/password', 'vps/start', 'pc/add', 'pc/user', 'pc/lights', 'pc/lights/session', 'pc/key', 'files/upload', 'files/rename', 'agent/update']) {
    assert.ok(allowedPath(p), p);
  }
  for (const p of ['pc/lights/link', 'vps/../status', 'agent/update/x', 'agent', 'pc/lights/r/abc', 'files/upload/x']) assert.ok(!allowedPath(p), p);
});

test('createApi streams a body with length, long timeout and half duplex', async () => {
  let seen;
  const api = createApi({
    getConfig: () => ({ baseUrl: 'https://x.example.com', token: 'tok' }),
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => '{"ok":true,"size":3}' }; },
  });
  const r = await api.call({ method: 'PUT', path: 'files/upload', query: { path: 'a/b', name: 'f.txt' }, bodyStream: Readable.from(['abc']), contentLength: 3 });
  assert.deepStrictEqual(r, { ok: true, size: 3 });
  assert.strictEqual(seen.url.searchParams.get('name'), 'f.txt');
  assert.strictEqual(seen.init.method, 'PUT');
  assert.strictEqual(seen.init.duplex, 'half');
  assert.strictEqual(seen.init.headers['Content-Length'], '3');
  assert.strictEqual(seen.init.headers.Authorization, 'Bearer tok');
});

test('VPS name and key validation follow the agent', () => {
  assert.strictEqual(M.validateVpsName('dev1'), '');
  assert.strictEqual(M.validateVpsName('a'), '');
  assert.ok(M.validateVpsName('1dev'));
  assert.ok(M.validateVpsName('Dev'));
  assert.ok(M.validateVpsName('dev-'));
  assert.ok(M.validateVpsName('a'.repeat(24)));
  assert.strictEqual(M.validateVpsName('a'.repeat(23)), '');
  assert.strictEqual(M.validateSshKey(''), '');
  assert.strictEqual(M.validateSshKey('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabcdefghijklmnop me@pc'), '');
  assert.ok(M.validateSshKey('hello world'));
  assert.ok(M.validateSshKey('ssh-ed25519 AAAA; rm -rf /'));
});

test('PC field validation follows the agent', () => {
  assert.strictEqual(M.normMac('aa-bb-cc-dd-ee-ff'), 'aa:bb:cc:dd:ee:ff');
  assert.strictEqual(M.normMac('AABBCCDDEEFF'), 'aa:bb:cc:dd:ee:ff');
  assert.strictEqual(M.normMac('aa:bb:cc:dd:ee'), null);
  assert.strictEqual(M.normMac('aa:bb-cc:dd-ee:ff'), null);
  assert.strictEqual(M.validateIp('192.168.1.20'), '');
  assert.strictEqual(M.validateIp('10.0.0.5'), '');
  assert.strictEqual(M.validateIp('172.20.1.1'), '');
  assert.ok(M.validateIp('8.8.8.8'));
  assert.ok(M.validateIp('172.32.0.1'));
  assert.ok(M.validateIp('192.168.1.300'));
  assert.ok(M.validateIp('pc.local'));
  assert.strictEqual(M.validatePcUser('', false), '');
  assert.ok(M.validatePcUser('', true));
  assert.strictEqual(M.validatePcUser('Jo.Smith_1', true), '');
  assert.ok(M.validatePcUser('a b', true));
  assert.ok(M.validatePcUser('x'.repeat(33), true));
  assert.strictEqual(M.validatePort(''), '');
  assert.strictEqual(M.validatePort('2222'), '');
  assert.ok(M.validatePort('0'));
  assert.ok(M.validatePort('70000'));
  assert.ok(M.validatePort('2.5'));
  assert.ok(M.validatePcName('x'.repeat(41)));
  assert.ok(M.validatePcName('  '));
});

test('lights link must be http, point at the PC and carry a token', () => {
  const ip = '192.168.0.174';
  assert.strictEqual(M.validateLightsUrl('', ip), '');
  assert.strictEqual(M.validateLightsUrl(`http://${ip}:47822/?t=abcdefgh1234`, ip), '');
  assert.ok(M.validateLightsUrl(`https://${ip}:47822/?t=abcdefgh1234`, ip));
  assert.ok(M.validateLightsUrl('http://192.168.0.5:47822/?t=abcdefgh1234', ip));
  assert.ok(M.validateLightsUrl(`http://${ip}:47822/`, ip));
  assert.ok(M.validateLightsUrl(`http://${ip}:47822/?t=short`, ip));
  assert.ok(M.validateLightsUrl(`http://u:p@${ip}/?t=abcdefgh1234`, ip));
  assert.ok(M.validateLightsUrl('nonsense', ip));
});

test('file names and remote folders reject traversal', () => {
  assert.strictEqual(M.validateEntryName('notes.txt'), '');
  assert.strictEqual(M.validateEntryName('a b (1).txt'), '');
  for (const n of ['', ' ', '.', '..', 'a/b', 'a\\b', 'a:b', 'x.part', 'a\0b', 'é'.repeat(130)]) assert.ok(M.validateEntryName(n), JSON.stringify(n));
  assert.ok(M.validateRemoteDir(''));
  assert.ok(M.validateRemoteDir('photos/2024'));
  for (const d of ['/abs', '../x', 'a/../b', 'a//b', 'a\\b', './a', 5, null]) assert.ok(!M.validateRemoteDir(d), String(d));
  assert.strictEqual(M.joinPath('', 'a'), 'a');
  assert.strictEqual(M.joinPath('x/y', 'a'), 'x/y/a');
  assert.strictEqual(M.MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
});

test('error text maps agent codes and passes unknown text through', () => {
  assert.match(M.vpsErrorText('low_space'), /storage/);
  assert.match(M.pcErrorText('auth_failed'), /key/);
  assert.match(M.filesErrorText('exists'), /already/);
  assert.match(M.updateErrorText('busy'), /already/);
  assert.strictEqual(M.vpsErrorText('weird thing'), 'weird thing');
  assert.strictEqual(M.vpsErrorText('', 'Fallback'), 'Fallback');
  assert.strictEqual(M.filesErrorText('constructor'), 'constructor');
});

test('updateSummary words each state', () => {
  assert.match(M.updateSummary({ current: '1.0.0', latest: '1.1.0', available: true }), /1\.1\.0 is available/);
  assert.match(M.updateSummary({ current: '1.0.0', latest: '1.0.0', available: false }), /Up to date/);
  assert.match(M.updateSummary({ current: '1.0.0', latest: null }), /No agent release/);
  assert.strictEqual(M.updateSummary({}), 'Version unknown');
});

test('filesErrorText words bad_path, not_found, exists and busy', () => {
  for (const c of ['bad_path', 'not_found', 'exists', 'busy']) {
    const t = M.filesErrorText(c, 'x');
    assert.notStrictEqual(t, c);
    assert.notStrictEqual(t, 'x');
  }
  assert.strictEqual(M.filesErrorText('', 'Could not restore'), 'Could not restore');
});
