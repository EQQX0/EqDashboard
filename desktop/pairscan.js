'use strict';
// Looks for a pairing file (*.s21) in a few folders so signing in needs no typing.
const fs = require('fs');
const path = require('path');
const { parsePair } = require('./api');

const MAX = 4096;

/** Returns { file, url, token } for the newest valid *.s21 file in [dirs], or null. */
function findPairFile(dirs, fsImpl = fs) {
  const found = [];
  for (const dir of dirs) {
    let names;
    try { names = fsImpl.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/\.s21$/i.test(n)) continue;
      const file = path.join(dir, n);
      try {
        const st = fsImpl.statSync(file);
        if (!st.isFile() || st.size > MAX) continue;
        found.push({ file, mtime: st.mtimeMs });
      } catch { /* unreadable, skip */ }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  for (const f of found) {
    try {
      const p = parsePair(fsImpl.readFileSync(f.file, 'utf8'));
      return { file: f.file, url: p.url, token: p.token };
    } catch { /* not a valid pairing file, try the next */ }
  }
  return null;
}

module.exports = { findPairFile };
