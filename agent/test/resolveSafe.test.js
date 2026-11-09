'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveSafe } = require('../files');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samsung-rs-'));
const root = path.join(tmp, 'root');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const bad = (rel) => assert.throws(() => resolveSafe(root, rel), (e) => e.code === 'bad_path' && e.status === 400, JSON.stringify(rel));

test('root itself', () => {
  for (const r of ['', '/']) assert.strictEqual(resolveSafe(root, r), path.resolve(root));
});

test('normal and not-yet-existing paths', () => {
  assert.strictEqual(resolveSafe(root, 'sub'), path.join(root, 'sub'));
  assert.strictEqual(resolveSafe(root, 'sub/new/deeper.txt'), path.join(root, 'sub', 'new', 'deeper.txt'));
  assert.strictEqual(resolveSafe(root, 'sub/'), path.join(root, 'sub'));
});

test('traversal', () => {
  for (const r of ['..', '../x', 'sub/../../x', 'sub/..', './a', 'a/./b']) bad(r);
});

test('encoded traversal', () => {
  for (const r of ['%2e%2e', '%2e%2e/x', 'sub/%2E%2E/%2e%2e/x', 'a%2f..%2fb']) bad(r);
});

test('absolute paths', () => {
  for (const r of ['/etc/passwd', '/sub', 'C:/Windows', 'c:\\x', '//server/share']) bad(r);
});

test('NUL, backslash, empty segments', () => {
  for (const r of ['a\0b', 'a%00b', 'a\\b', 'a%5Cb', 'a//b', '//']) bad(r);
  bad(null);
  bad(undefined);
});

test('overlong segment', () => bad('a'.repeat(256)));

test('unicode names are accepted', () => {
  for (const n of ['файл.txt', '写真/日本語.jpg', 'emoji 😀.png', 'é']) {
    assert.strictEqual(resolveSafe(root, n), path.join(root, ...n.split('/')));
  }
});

test('symlink escape is rejected', (t) => {
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), type);
  } catch (e) {
    return t.skip('cannot create symlinks: ' + e.code);
  }
  bad('link');
  bad('link/secret.txt');
  bad('link/newfile.txt');
  try {
    fs.symlinkSync(path.join(outside, 'missing'), path.join(root, 'dangling'), 'file');
    bad('dangling');
  } catch (e) {
    if (e.code === 'EPERM') return; // file symlinks need privileges on Windows
    throw e;
  }
});

test('symlink inside root is allowed', (t) => {
  try {
    fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'inner'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch { return t.skip('cannot create symlinks'); }
  assert.doesNotThrow(() => resolveSafe(root, 'inner/file.txt'));
});
