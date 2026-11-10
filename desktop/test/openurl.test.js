'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { allowedOpenHost } = require('../openurl');

test('allowedOpenHost allows https on the parent domain only', () => {
  const base = 'https://api.eqqx2.com';
  assert.ok(allowedOpenHost('https://eqqx2.com/', base));
  assert.ok(allowedOpenHost('https://mysite.eqqx2.com/x', base));
  assert.ok(allowedOpenHost('https://api.eqqx2.com/pc/lights/r/abc/', base));
  assert.ok(!allowedOpenHost('http://mysite.eqqx2.com/', base));
  assert.ok(!allowedOpenHost('https://evil.com/', base));
  assert.ok(!allowedOpenHost('https://eqqx2.com.evil.com/', base));
  assert.ok(!allowedOpenHost('https://noteqqx2.com/', base));
  assert.ok(!allowedOpenHost('file:///C:/x', base));
  assert.ok(!allowedOpenHost('nonsense', base));
  assert.ok(!allowedOpenHost('https://eqqx2.com/', ''));
  assert.ok(!allowedOpenHost('https://com/', 'https://eqqx2.com'));
});
