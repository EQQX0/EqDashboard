'use strict';
const { guard, send } = require('../lib/auth');
const gh = require('../lib/github');

module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const found = await gh.loadLatest(globalThis.fetch, gh.context());
    if (!found) return send(res, 404, 'no_release');
    const { release, meta } = found;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      versionCode: meta.versionCode,
      versionName: meta.versionName,
      sha256: meta.sha256,
      size: meta.size,
      notes: meta.notes,
      publishedAt: release.published_at || null,
    });
  } catch (e) {
    // Reason only (e.g. "status 401"); never log tokens, headers or env values.
    console.error('latest upstream failure:', e instanceof gh.UpstreamError ? e.message : 'unexpected');
    send(res, 502, 'upstream');
  }
};
