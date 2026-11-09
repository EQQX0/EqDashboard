'use strict';

const API = 'https://api.github.com';

class UpstreamError extends Error {}

function baseHeaders(token, accept) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 's21-updates-gate',
  };
}

// Returns the release object, or null when the repo has no published release.
async function getLatestRelease(fetchFn, { repo, token }) {
  let r;
  try {
    r = await fetchFn(`${API}/repos/${repo}/releases/latest`, {
      headers: baseHeaders(token, 'application/vnd.github+json'),
    });
  } catch (e) {
    throw new UpstreamError('fetch failed');
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new UpstreamError('status ' + r.status);
  try {
    return await r.json();
  } catch (e) {
    throw new UpstreamError('bad json');
  }
}

function findAsset(release, name) {
  const a = ((release && release.assets) || []).find((x) => x && x.name === name);
  return a || null;
}

function assetUrl(repo, asset) {
  return asset.url || `${API}/repos/${repo}/releases/assets/${asset.id}`;
}

async function readMeta(fetchFn, { repo, token }, asset) {
  let r;
  try {
    r = await fetchFn(assetUrl(repo, asset), {
      headers: baseHeaders(token, 'application/octet-stream'),
      redirect: 'follow',
    });
  } catch (e) {
    throw new UpstreamError('fetch failed');
  }
  if (!r.ok) throw new UpstreamError('status ' + r.status);
  try {
    const m = JSON.parse(await r.text());
    if (!m || !Number.isInteger(m.versionCode)) throw new Error('bad meta');
    return m;
  } catch (e) {
    throw new UpstreamError('bad meta');
  }
}

// Returns the signed Location URL for the asset, never the bytes.
async function getSignedLocation(fetchFn, { repo, token }, asset) {
  let r;
  try {
    r = await fetchFn(assetUrl(repo, asset), {
      headers: baseHeaders(token, 'application/octet-stream'),
      redirect: 'manual',
    });
  } catch (e) {
    throw new UpstreamError('fetch failed');
  }
  const loc = r.status === 302 && r.headers && r.headers.get ? r.headers.get('location') : null;
  if (!loc) throw new UpstreamError('no redirect');
  return loc;
}

// Shared by both endpoints: { release, meta, apkAsset } or null for no_release.
async function loadLatest(fetchFn, ctx) {
  const release = await getLatestRelease(fetchFn, ctx);
  if (!release || release.draft || release.prerelease) return null;
  const metaAsset = findAsset(release, 'meta.json');
  const apkAsset = findAsset(release, 'app.apk');
  if (!metaAsset || !apkAsset) return null;
  const meta = await readMeta(fetchFn, ctx, metaAsset);
  return { release, meta, apkAsset };
}

function context() {
  return {
    repo: process.env.GITHUB_REPO || 'EQQX0/EqDashboard',
    token: process.env.GITHUB_TOKEN,
  };
}

module.exports = { UpstreamError, getLatestRelease, findAsset, readMeta, getSignedLocation, loadLatest, context };
