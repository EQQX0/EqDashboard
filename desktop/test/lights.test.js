'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildLightsUrl, sameOrigin } = require('../lights-url');

const hex = 'a'.repeat(32);
test('lights url is rebuilt from base and exact session path', () => {
  assert.strictEqual(buildLightsUrl('https://api.eqqx2.com/', `/pc/lights/r/${hex}/`), `https://api.eqqx2.com/pc/lights/r/${hex}/`);
  assert.strictEqual(buildLightsUrl('https://api.eqqx2.com', `/pc/lights/r/${hex}/`), `https://api.eqqx2.com/pc/lights/r/${hex}/`);
});
test('lights url rejects bad paths and bases', () => {
  for (const p of [`/pc/lights/r/${'a'.repeat(31)}/`, `/pc/lights/r/${'A'.repeat(32)}/`, `/pc/lights/r/${hex}`, `/pc/lights/r/${hex}/x`,
    `//evil.com/pc/lights/r/${hex}/`, `/pc/lights/r/${hex}/\n`, undefined, null, 5, {}]) assert.strictEqual(buildLightsUrl('https://api.eqqx2.com', p), '', String(p));
  for (const b of ['http://api.eqqx2.com', '', 'ftp://x', 'api.eqqx2.com', undefined, 'https://u:p@api.eqqx2.com']) assert.strictEqual(buildLightsUrl(b, `/pc/lights/r/${hex}/`), '', String(b));
});
test('sameOrigin confines navigation', () => {
  const l = `https://api.eqqx2.com/pc/lights/r/${hex}/`;
  assert.ok(sameOrigin('https://api.eqqx2.com/pc/lights/r/x', l));
  assert.ok(!sameOrigin('https://evil.com/', l));
  assert.ok(!sameOrigin('http://api.eqqx2.com/', l));
  assert.ok(!sameOrigin('https://api.eqqx2.com:8443/', l));
  assert.ok(!sameOrigin('nonsense', l));
});
