'use strict';
const { guard, send } = require('../lib/auth');
const gh = require('../lib/github');

function queryVersion(req) {
  let v = req.query && req.query.versionCode;
  if (v === undefined) {
    try {
      v = new URL(req.url || '', 'http://x').searchParams.get('versionCode');
    } catch (e) {}
  }
  if (Array.isArray(v)) v = v[0];
  return typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : null;
}

module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  const wanted = queryVersion(req);
  if (wanted === null) return send(res, 404, 'no_such_version');
  try {
    const ctx = gh.context();
    const found = await gh.loadLatest(globalThis.fetch, ctx);
    if (!found) return send(res, 404, 'no_release');
    if (found.meta.versionCode !== wanted) return send(res, 404, 'no_such_version');
    const url = await gh.getSignedLocation(globalThis.fetch, ctx, found.apkAsset);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ url, expiresInSec: 300 });
  } catch (e) {
    // Reason only (e.g. "status 401"); never log tokens, headers or env values.
    console.error('apk upstream failure:', e instanceof gh.UpstreamError ? e.message : 'unexpected');
    send(res, 502, 'upstream');
  }
};
