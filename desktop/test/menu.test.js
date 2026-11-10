'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../renderer/menu-logic');

test('trigger keys open the menu', () => {
  for (const k of ['Enter', ' ', 'ArrowDown']) assert.deepStrictEqual(M.triggerKey(k), { open: true, index: 0 });
  assert.deepStrictEqual(M.triggerKey('ArrowUp'), { open: true, index: -1 });
  assert.strictEqual(M.triggerKey('a'), null);
});
test('arrow keys wrap, Home and End jump', () => {
  assert.deepStrictEqual(M.menuKey('ArrowDown', 2, 3), { index: 0, action: 'focus' });
  assert.deepStrictEqual(M.menuKey('ArrowUp', 0, 3), { index: 2, action: 'focus' });
  assert.deepStrictEqual(M.menuKey('Home', 2, 3), { index: 0, action: 'focus' });
  assert.deepStrictEqual(M.menuKey('End', 0, 3), { index: 2, action: 'focus' });
});
test('Enter and Space activate, Escape closes and returns focus, Tab closes', () => {
  assert.strictEqual(M.menuKey('Enter', 1, 3).action, 'activate');
  assert.strictEqual(M.menuKey(' ', 1, 3).index, 1);
  assert.deepStrictEqual(M.menuKey('Escape', 1, 3), { index: 1, action: 'close', returnFocus: true });
  assert.strictEqual(M.menuKey('Tab', 1, 3).returnFocus, false);
  assert.strictEqual(M.menuKey('x', 1, 3).action, 'none');
});
test('bad index or empty menu is safe', () => {
  assert.strictEqual(M.menuKey('ArrowDown', -1, 3).index, 1);
  assert.strictEqual(M.menuKey('ArrowDown', 0, 0).action, 'close');
});
test('menu items', () => {
  assert.deepStrictEqual(M.menuItems({ sshUser: 'a' }).map((i) => i.id), ['shutdown', 'user', 'lights']);
  assert.strictEqual(M.menuItems({}).length, 3);
});
