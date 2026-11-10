'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../renderer/toast-logic');

test('durationFor: errors last longer, unknown kinds act like info', () => {
  assert.strictEqual(T.durationFor('success'), 4000);
  assert.strictEqual(T.durationFor('info'), 4000);
  assert.strictEqual(T.durationFor('error'), 7000);
  assert.strictEqual(T.durationFor(undefined), 4000);
  assert.strictEqual(T.durationFor('nope'), 4000);
});

test('pushToast appends newest last and defaults the kind to info', () => {
  const r = T.pushToast([], { id: 1, msg: 'a' });
  assert.deepStrictEqual(r.list, [{ id: 1, msg: 'a', kind: 'info' }]);
  assert.strictEqual(r.coalesced, null);
  const r2 = T.pushToast(r.list, { id: 2, msg: 'b', kind: 'error' });
  assert.deepStrictEqual(r2.list.map((t) => t.id), [1, 2]);
});

test('identical consecutive message coalesces instead of stacking', () => {
  const a = T.pushToast([], { id: 1, msg: 'Saved', kind: 'success' });
  const b = T.pushToast(a.list, { id: 2, msg: 'Saved', kind: 'success' });
  assert.strictEqual(b.coalesced, 1);
  assert.strictEqual(b.list.length, 1);
});

test('same text with a different kind, or a non-consecutive repeat, is a new toast', () => {
  let r = T.pushToast([], { id: 1, msg: 'x', kind: 'info' });
  r = T.pushToast(r.list, { id: 2, msg: 'x', kind: 'error' });
  assert.strictEqual(r.coalesced, null);
  r = T.pushToast(r.list, { id: 3, msg: 'y' });
  r = T.pushToast(r.list, { id: 4, msg: 'x', kind: 'error' });
  assert.strictEqual(r.coalesced, null);
  assert.strictEqual(r.list.length, 3);
});

test('more than three trims the oldest', () => {
  let list = [];
  const dropped = [];
  for (let i = 1; i <= 5; i++) {
    const r = T.pushToast(list, { id: i, msg: 'm' + i });
    list = r.list; dropped.push(...r.dropped);
  }
  assert.deepStrictEqual(list.map((t) => t.id), [3, 4, 5]);
  assert.deepStrictEqual(dropped, [1, 2]);
});

test('removeToast and newestId', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.strictEqual(T.newestId(list), 3);
  assert.deepStrictEqual(T.removeToast(list, 3).map((t) => t.id), [1, 2]);
  assert.strictEqual(T.newestId([]), null);
});

test('pauseToast after armToast computes remaining; clearing sets timer to null', () => {
  let clock = 1000;
  const cleared = [];
  const deps = { setTimeout: () => 42, clearTimeout: (x) => cleared.push(x), now: () => clock };
  const t = { timer: null, remaining: 4000, started: 0, hover: false, focus: false };
  T.armToast(t, () => {}, deps);
  assert.strictEqual(t.timer, 42);
  clock = 2500;
  T.pauseToast(t, deps);
  assert.strictEqual(t.timer, null);
  assert.strictEqual(t.remaining, 2500);
  // Hovered re-arm must leave the timer null so a later pause does not subtract again.
  t.hover = true;
  T.armToast(t, () => {}, deps);
  assert.strictEqual(t.timer, null);
  clock = 9000;
  T.pauseToast(t, deps);
  assert.strictEqual(t.remaining, 2500);
});
