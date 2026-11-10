'use strict';
// Pure keyboard model for the PC card overflow menu. Loaded by the page as a plain script and by the tests via require().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MenuLogic = api;
}(typeof self !== 'undefined' ? self : this, function () {
  // Keys on the trigger button: Enter, Space and ArrowDown open at the first item, ArrowUp opens at the last.
  function triggerKey(key) {
    if (key === 'Enter' || key === ' ' || key === 'Spacebar' || key === 'ArrowDown') return { open: true, index: 0 };
    if (key === 'ArrowUp') return { open: true, index: -1 };
    return null;
  }

  // Keys inside the open menu. Returns { index, action } where action is 'focus', 'activate', 'close' or 'none'.
  // 'close' with returnFocus true means focus goes back to the trigger. Tab closes without stealing focus.
  function menuKey(key, current, count) {
    if (!(count > 0)) return { index: -1, action: 'close', returnFocus: true };
    const cur = Number.isInteger(current) && current >= 0 && current < count ? current : 0;
    switch (key) {
      case 'ArrowDown': return { index: (cur + 1) % count, action: 'focus' };
      case 'ArrowUp': return { index: (cur - 1 + count) % count, action: 'focus' };
      case 'Home': return { index: 0, action: 'focus' };
      case 'End': return { index: count - 1, action: 'focus' };
      case 'Enter': case ' ': case 'Spacebar': return { index: cur, action: 'activate' };
      case 'Escape': return { index: cur, action: 'close', returnFocus: true };
      case 'Tab': return { index: cur, action: 'close', returnFocus: false };
      default: return { index: cur, action: 'none' };
    }
  }

  // Which items the menu shows, in order.
  function menuItems(pc) {
    return [
      { id: 'shutdown', label: pc && pc.sshUser ? 'Shutdown setup\u2026' : 'Set up shutdown\u2026' },
      { id: 'user', label: 'Windows user\u2026' },
      { id: 'lights', label: 'Lights link\u2026' },
    ];
  }

  return { triggerKey, menuKey, menuItems };
}));
