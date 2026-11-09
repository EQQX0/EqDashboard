'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, buildPairFile, run, DEFAULT_URL } = require('../pair');

const TOKEN = 'unit-test-token-0123456789abcdef';

function setup(env = { AGENT_TOKEN: TOKEN }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's21pair-'));
  const out = [];
  const err = [];
  const call = (argv) => run({
    argv, env, home: dir, cwd: dir, dir,
    stdout: (s) => out.push(s), stderr: (s) => err.push(s),
  });
  return { dir, out, err, call };
}

test('parseArgs default url', () => {
  assert.strictEqual(parseArgs([]).url, DEFAULT_URL);
});

test('parseArgs custom url, out and force', () => {
  const a = parseArgs(['--url', 'https://x.example', '--out', 'f.s21', '--force']);
  assert.deepStrictEqual([a.url, a.out, a.force], ['https://x.example', 'f.s21', true]);
});

test('buildPairFile content parses to expected object', () => {
  assert.deepStrictEqual(JSON.parse(buildPairFile('https://a.b/', 'tok')), { v: 1, url: 'https://a.b', token: 'tok' });
});

test('writes file with default url and never prints the token', () => {
  const s = setup();
  assert.strictEqual(s.call([]), 0);
  const file = path.join(s.dir, 's21-control.s21');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 1, url: DEFAULT_URL, token: TOKEN });
  const printed = [...s.out, ...s.err].join('\n');
  assert.ok(!printed.includes(TOKEN));
  assert.ok(printed.includes('rm ' + file));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('prefers storage/downloads when it exists', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.dir, 'storage', 'downloads'), { recursive: true });
  assert.strictEqual(s.call([]), 0);
  assert.ok(fs.existsSync(path.join(s.dir, 'storage', 'downloads', 's21-control.s21')));
});

test('custom url is written', () => {
  const s = setup();
  const out = path.join(s.dir, 'c.s21');
  assert.strictEqual(s.call(['--url', 'https://custom.example', '--out', out]), 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).url, 'https://custom.example');
});

test('refuses when no token is available', () => {
  const s = setup({});
  assert.strictEqual(s.call([]), 1);
  assert.ok(s.err.join('\n').includes('No agent token'));
  assert.ok(!fs.existsSync(path.join(s.dir, 's21-control.s21')));
});

test('refuses to overwrite without --force, allows with it', () => {
  const s = setup();
  const out = path.join(s.dir, 'c.s21');
  fs.writeFileSync(out, 'old');
  assert.strictEqual(s.call(['--out', out]), 1);
  assert.strictEqual(fs.readFileSync(out, 'utf8'), 'old');
  assert.ok(!s.err.join('\n').includes(TOKEN));
  assert.strictEqual(s.call(['--out', out, '--force']), 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).token, TOKEN);
});

test('rejects non-https url', () => {
  const s = setup();
  assert.strictEqual(s.call(['--url', 'http://x.example']), 2);
});
