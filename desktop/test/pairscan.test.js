'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findPairFile } = require('../pairscan');

const TOK = 'b'.repeat(48);
const good = (url) => JSON.stringify({ v: 1, url, token: TOK });

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pairscan-')); }

test('finds the newest valid pairing file and ignores others', () => {
  const a = tmp(), b = tmp();
  fs.writeFileSync(path.join(a, 'old.pair'), good('https://old.example.com'));
  fs.utimesSync(path.join(a, 'old.pair'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  fs.writeFileSync(path.join(b, 'new.pair'), good('https://new.example.com'));
  fs.writeFileSync(path.join(b, 'broken.pair'), 'not json');
  fs.writeFileSync(path.join(b, 'notes.txt'), good('https://txt.example.com'));
  const r = findPairFile([a, b, path.join(a, 'missing')]);
  assert.strictEqual(r.url, 'https://new.example.com');
  assert.strictEqual(r.token, TOK);
  assert.strictEqual(path.basename(r.file), 'new.pair');
});

test('ignores files that are not .pair', () => {
  const a = tmp();
  fs.writeFileSync(path.join(a, 'old.key'), good('https://old.example.com'));
  assert.strictEqual(findPairFile([a]), null);
});

test('returns null when nothing valid is there', () => {
  const a = tmp();
  fs.writeFileSync(path.join(a, 'x.pair'), JSON.stringify({ v: 1, url: 'http://insecure.example.com', token: TOK }));
  fs.writeFileSync(path.join(a, 'big.pair'), 'x'.repeat(5000));
  assert.strictEqual(findPairFile([a]), null);
  assert.strictEqual(findPairFile([]), null);
});
