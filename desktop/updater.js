'use strict';
// Pure helpers for the Windows self-update. No network or Electron here, so it can be tested directly.

const RELEASES_URL = 'https://api.github.com/repos/EQQX0/EqDashboard/releases?per_page=10';
const INSTALLER_RE = /^Samsung-Server-Setup-(\d+\.\d+\.\d+)\.exe$/;
const SHA_ASSET_RE = /^Samsung-Server-Setup-\d+\.\d+\.\d+\.exe\.sha256$/;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v == null ? '' : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Returns -1, 0 or 1. Anything that is not x.y.z sorts below every valid version.
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// Only https://github.com/... is accepted as a starting point. Redirects are the downloader's business.
function isAllowedDownloadUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && x.hostname === 'github.com' && !x.username && !x.password && (x.port === '' || x.port === '443');
  } catch { return false; }
}

// Hosts a download may end up on after GitHub redirects it.
function isAllowedFinalHost(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && (x.hostname === 'github.com' || x.hostname === 'objects.githubusercontent.com' || x.hostname === 'release-assets.githubusercontent.com');
  } catch { return false; }
}

// "sha256:<hex>" from the asset digest, else the first hash in a .sha256 sibling's text, else ''.
function parseDigest(digest) {
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(String(digest == null ? '' : digest).trim());
  return m ? m[1].toLowerCase() : '';
}
function expectedSha256(asset, release, shaText) {
  const d = parseDigest(asset && asset.digest);
  if (d) return d;
  const side = ((release && release.assets) || []).find((a) => a && a.name === (asset && asset.name) + '.sha256' && SHA_ASSET_RE.test(a.name));
  if (side && typeof shaText === 'string') {
    const m = /\b([0-9a-fA-F]{64})\b/.exec(shaText);
    if (m) return m[1].toLowerCase();
  }
  return '';
}
// The .sha256 sibling asset for an installer, or null. Lets the caller fetch its text only when needed.
function sha256Asset(asset, release) {
  return ((release && release.assets) || []).find((a) => a && a.name === (asset && asset.name) + '.sha256' && SHA_ASSET_RE.test(a.name)) || null;
}

// Highest stable release that ships an installer and is newer than currentVersion, or null.
function pickRelease(releases, currentVersion) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || r.prerelease) continue;
    const asset = (r.assets || []).find((a) => a && typeof a.name === 'string' && INSTALLER_RE.test(a.name) && a.browser_download_url);
    if (!asset) continue;
    const version = INSTALLER_RE.exec(asset.name)[1];
    if (compareVersions(version, currentVersion) <= 0) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = { version, release: r, asset, notes: String(r.body || ''), size: Number(asset.size) || 0, url: asset.browser_download_url, sha256: parseDigest(asset.digest) };
  }
  return best;
}

module.exports = { RELEASES_URL, compareVersions, parseVersion, pickRelease, isAllowedDownloadUrl, isAllowedFinalHost, parseDigest, expectedSha256, sha256Asset };
