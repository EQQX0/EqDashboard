'use strict';
const test = require('node:test');
const assert = require('node:assert');
const U = require('../updater');

const HEX = 'a'.repeat(64);
const rel = (tag, assets, extra) => ({ tag_name: tag, draft: false, prerelease: false, body: 'notes ' + tag, assets, ...extra });
const exe = (v, extra) => ({ name: `Samsung-Server-Setup-${v}.exe`, size: 100, browser_download_url: `https://github.com/EQQX0/EqDashboard/releases/download/v${v}/Samsung-Server-Setup-${v}.exe`, ...extra });
const apk = { name: 'app.apk', size: 5, browser_download_url: 'https://github.com/x/app.apk' };

test('compareVersions', () => {
  assert.strictEqual(U.compareVersions('0.13.5', '0.13.5'), 0);
  assert.strictEqual(U.compareVersions('0.13.6', '0.13.5'), 1);
  assert.strictEqual(U.compareVersions('0.9.0', '0.13.0'), -1);
  assert.strictEqual(U.compareVersions('v1.0.0', '0.99.99'), 1);
  assert.strictEqual(U.compareVersions('junk', '0.0.1'), -1);
});

test('pickRelease skips APK-only, drafts, prereleases and older', () => {
  const rs = [
    rel('v0.14.0', [apk]),
    rel('v0.15.0', [exe('0.15.0')], { draft: true }),
    rel('v0.16.0', [exe('0.16.0')], { prerelease: true }),
    rel('v0.13.5', [exe('0.13.5')]),
    rel('v0.13.0', [exe('0.13.0')]),
  ];
  assert.strictEqual(U.pickRelease(rs, '0.13.5'), null);
});

test('pickRelease picks the highest newer release', () => {
  const rs = [rel('v0.13.6', [apk, exe('0.13.6')]), rel('v0.14.1', [exe('0.14.1')]), rel('v0.14.0', [exe('0.14.0')])];
  const p = U.pickRelease(rs, '0.13.5');
  assert.strictEqual(p.version, '0.14.1');
  assert.strictEqual(p.notes, 'notes v0.14.1');
  assert.strictEqual(p.size, 100);
  assert.strictEqual(p.sha256, '');
});

test('pickRelease ignores badly named installers and bad input', () => {
  assert.strictEqual(U.pickRelease([rel('v9.0.0', [{ name: 'Samsung-Server-Setup-9.0.0.exe.blockmap', browser_download_url: 'https://github.com/a' }, { name: 'Samsung-Server-Setup-9.0.exe', browser_download_url: 'https://github.com/a' }])], '0.1.0'), null);
  assert.strictEqual(U.pickRelease(null, '0.1.0'), null);
});

test('digest extraction', () => {
  assert.strictEqual(U.parseDigest('sha256:' + HEX.toUpperCase()), HEX);
  assert.strictEqual(U.parseDigest('sha1:abc'), '');
  assert.strictEqual(U.parseDigest('sha256:short'), '');
  assert.strictEqual(U.parseDigest(null), '');
  const p = U.pickRelease([rel('v1.0.0', [exe('1.0.0', { digest: 'sha256:' + HEX })])], '0.1.0');
  assert.strictEqual(p.sha256, HEX);
});

test('expectedSha256 prefers digest, then .sha256 asset, else none', () => {
  const a = exe('1.0.0');
  const side = { name: a.name + '.sha256', browser_download_url: 'https://github.com/s' };
  const r = rel('v1.0.0', [a, side]);
  assert.strictEqual(U.expectedSha256(a, r, `${'B'.repeat(64)}  ${a.name}\n`), 'b'.repeat(64));
  assert.strictEqual(U.expectedSha256({ ...a, digest: 'sha256:' + HEX }, r, 'b'.repeat(64)), HEX);
  assert.strictEqual(U.expectedSha256(a, rel('v1.0.0', [a]), 'b'.repeat(64)), '');
  assert.strictEqual(U.expectedSha256(a, r, 'nothing here'), '');
  assert.strictEqual(U.sha256Asset(a, r), side);
});

test('host checks', () => {
  assert.ok(U.isAllowedDownloadUrl('https://github.com/EQQX0/EqDashboard/releases/download/v1/x.exe'));
  assert.ok(!U.isAllowedDownloadUrl('http://github.com/x'));
  assert.ok(!U.isAllowedDownloadUrl('https://evil.com/github.com/x'));
  assert.ok(!U.isAllowedDownloadUrl('https://github.com.evil.com/x'));
  assert.ok(!U.isAllowedDownloadUrl('https://user@github.com/x'));
  assert.ok(!U.isAllowedDownloadUrl('https://objects.githubusercontent.com/x'));
  assert.ok(!U.isAllowedDownloadUrl('nonsense'));
  assert.ok(U.isAllowedFinalHost('https://objects.githubusercontent.com/x'));
  assert.ok(U.isAllowedFinalHost('https://release-assets.githubusercontent.com/x'));
  assert.ok(!U.isAllowedFinalHost('https://evilgithubusercontent.com/x'));
  assert.ok(!U.isAllowedFinalHost('https://attacker.example/x'));
});
