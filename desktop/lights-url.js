'use strict';
// Builds and checks the URL of the in-app lights window. Pure, so it is tested without Electron.
// Only a session path of the exact shape the agent issues is accepted, and it is appended to the saved https server address.

const SESSION_PATH = /^\/pc\/lights\/r\/[a-f0-9]{32}\/$/;

// Returns the full lights URL, or '' when the base address or the session path is not acceptable.
function buildLightsUrl(baseUrl, sessionPath) {
  if (typeof sessionPath !== 'string' || !SESSION_PATH.test(sessionPath)) return '';
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) return '';
  try {
    const u = new URL(base + sessionPath);
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    return u.toString();
  } catch { return ''; }
}

// True when `target` has the same origin as `lightsUrl`. Used to confine navigation inside the lights window.
function sameOrigin(target, lightsUrl) {
  try { return new URL(String(target)).origin === new URL(String(lightsUrl)).origin; } catch { return false; }
}

module.exports = { buildLightsUrl, sameOrigin, SESSION_PATH };
