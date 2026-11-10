'use strict';
// Decides which links the app may open in the browser: https only, and only on the saved server's parent domain
// (api.eqqx2.com -> eqqx2.com, so eqqx2.com and any *.eqqx2.com).

function allowedOpenHost(url, baseUrl) {
  let u;
  let b;
  try { u = new URL(String(url)); b = new URL(String(baseUrl)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const labels = b.hostname.toLowerCase().split('.');
  if (labels.length < 3) return false;
  const domain = labels.slice(1).join('.');
  const host = u.hostname.toLowerCase();
  return host === domain || host.endsWith('.' + domain);
}

module.exports = { allowedOpenHost };
