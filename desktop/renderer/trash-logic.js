'use strict';
// Pure helpers for the Recycle bin view. Loaded by the page as a plain script and by the tests via require().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrashLogic = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const URGENT_DAYS = 3;

  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  // "just now", "5 minutes ago", "3 hours ago", "yesterday", "12 days ago". Bad or future times read as "just now".
  function relativeTime(ts, now) {
    if (!Number.isFinite(ts) || !Number.isFinite(now)) return '';
    const d = Math.max(0, now - ts);
    if (d < MIN) return 'just now';
    if (d < HOUR) return plural(Math.floor(d / MIN), 'minute') + ' ago';
    if (d < DAY) return plural(Math.floor(d / HOUR), 'hour') + ' ago';
    const days = Math.floor(d / DAY);
    return days === 1 ? 'yesterday' : plural(days, 'day') + ' ago';
  }

  // Whole days left, rounded up so "23 hours" reads as 1 day. null when the item never expires.
  function daysLeft(expiresAt, now) {
    if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return null;
    return Math.max(0, Math.ceil((expiresAt - now) / DAY));
  }

  function daysLeftText(n) {
    if (n == null) return 'Kept until you delete it';
    if (n === 0) return 'Deletes today';
    return `Deletes in ${plural(n, 'day')}`;
  }

  // Folder part of an original path, shown as "/a/b". '' when unknown, "/" for the top level.
  function originalFolder(p) {
    if (typeof p !== 'string' || !p) return '';
    const parts = p.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
  }

  function rowModel(item, now) {
    const left = daysLeft(item.expiresAt, now);
    return {
      id: item.id,
      name: String(item.name || item.id),
      isDir: !!item.isDir,
      size: item.isDir ? null : Number(item.size) || 0,
      deletedText: 'Deleted ' + (relativeTime(item.deletedAt, now) || 'earlier'),
      leftText: daysLeftText(left),
      urgent: left != null && left <= URGENT_DAYS,
      folder: originalFolder(item.originalPath),
    };
  }

  function headerText(days) {
    return Number(days) > 0 ? `Files are removed permanently after ${days} days` : 'Files stay here until you delete them';
  }

  return { relativeTime, daysLeft, daysLeftText, originalFolder, rowModel, headerText, URGENT_DAYS };
}));
