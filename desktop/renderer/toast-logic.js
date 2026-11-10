'use strict';
// Pure helpers for the toast stack. Loaded by the page as a plain script and by the tests via require().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ToastLogic = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const KINDS = ['success', 'error', 'info'];
  const MAX_VISIBLE = 3;
  // Errors stay longer so they can be read; they can always be dismissed by hand.
  const DURATIONS = { success: 4000, info: 4000, error: 7000 };

  function normKind(kind) { return KINDS.includes(kind) ? kind : 'info'; }
  function durationFor(kind) { return DURATIONS[normKind(kind)]; }

  // list is ordered oldest to newest (newest renders at the bottom). Returns a new list plus what changed:
  //   coalesced: the id of the newest toast when the same message repeats (caller restarts its timer), else null
  //   dropped:   ids trimmed off the old end to stay within max
  function pushToast(list, item, max = MAX_VISIBLE) {
    const kind = normKind(item.kind);
    const last = list[list.length - 1];
    if (last && last.msg === item.msg && last.kind === kind) {
      return { list: list.slice(), coalesced: last.id, dropped: [] };
    }
    const next = list.concat([{ id: item.id, msg: item.msg, kind }]);
    const dropped = next.length > max ? next.splice(0, next.length - max).map((t) => t.id) : [];
    return { list: next, coalesced: null, dropped };
  }

  function removeToast(list, id) { return list.filter((t) => t.id !== id); }
  function newestId(list) { return list.length ? list[list.length - 1].id : null; }

  // Timer bookkeeping. deps = { setTimeout, clearTimeout, now } so tests can fake the clock.
  function armToast(t, onExpire, deps) {
    deps.clearTimeout(t.timer);
    t.timer = null;
    if (t.hover || t.focus) return;
    t.started = deps.now();
    t.timer = deps.setTimeout(onExpire, t.remaining);
  }
  function pauseToast(t, deps) {
    if (t.timer == null) return;
    deps.clearTimeout(t.timer); t.timer = null;
    t.remaining = Math.max(500, t.remaining - (deps.now() - t.started));
  }

  return { armToast, pauseToast, KINDS, MAX_VISIBLE, DURATIONS, normKind, durationFor, pushToast, removeToast, newestId };
}));
