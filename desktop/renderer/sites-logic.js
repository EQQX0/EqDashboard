'use strict';
// Pure helpers for the Sites tab. Loaded by the page as a plain script and by main.js and the tests via require().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SitesLogic = api;
}(typeof self !== 'undefined' ? self : this, function () {
  // Same rules as agent/sites.js and the Android app.
  const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
  const RESERVED = new Set([
    'api', 'files', 'gym', 'downloader', 'www', 'mail', 'smtp', 'ftp', 'ssh', 'admin', 'root', 'app', 'dashboard',
    'cloud', 'sites', 'static', 'assets', 'eq', 'vercel', 'cdn', 'ns1', 'ns2',
  ]);
  // Cloudflare refuses request bodies over 100 MB on the free plan, so stop there even though the agent accepts more.
  const MAX_ZIP_BYTES = 100 * 1024 * 1024;

  // Returns '' when the name is fine, otherwise the text to show under the field.
  function validateSiteName(raw) {
    const name = String(raw == null ? '' : raw).trim();
    if (!name) return 'Enter a name';
    if (!NAME_RE.test(name)) return 'Use 1-32 lowercase letters, numbers or hyphens (not at the start or end)';
    if (RESERVED.has(name)) return 'That name is reserved';
    return '';
  }

  function siteAddress(raw, domain) {
    const name = String(raw || '').trim();
    return (name || 'name') + '.' + (domain || 'yourdomain.com');
  }

  const ERRORS = {
    bad_name: 'Use 1-32 lowercase letters, numbers or hyphens',
    reserved_name: 'That name is reserved',
    exists: 'A site with that name already exists',
    too_large: 'Too big. Cloudflare allows 100 MB per upload',
    bad_zip: "That isn't a valid zip file",
    unsafe_zip: "The zip contains files that aren't allowed (paths outside the site, links)",
    not_found: 'That site was not found',
    file_unreadable: 'Could not read that file',
  };
  function siteErrorText(code, fallback) {
    const c = String(code || '');
    return Object.prototype.hasOwnProperty.call(ERRORS, c) ? ERRORS[c] : (c || fallback || 'Action failed');
  }

  return { NAME_RE, RESERVED, MAX_ZIP_BYTES, validateSiteName, siteAddress, siteErrorText };
}));
