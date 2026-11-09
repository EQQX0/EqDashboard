// Stand-in for yt-dlp in tests. Understands the flags downloads.js passes and prints the same line formats.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2099.01.01'); process.exit(0); }

if (process.env.FAKE_YT_LOG) fs.appendFileSync(process.env.FAKE_YT_LOG, JSON.stringify(args) + '\n');

const url = args[args.indexOf('--') + 1];
const home = args[args.indexOf('--paths') + 1].replace(/^home:/, '');
const temp = args[args.lastIndexOf('--paths') + 1].replace(/^temp:/, '');
fs.mkdirSync(temp, { recursive: true });
fs.writeFileSync(path.join(temp, 'video.part'), 'partial');

if (url.includes('fail')) {
  console.error('ERROR: [generic] Unsupported URL: ' + url);
  process.exit(1);
}
console.log('NAME|Fake Title');
console.log('DL|250|1000|NA|50|15');
if (url.includes('slow')) {
  setInterval(() => {}, 1000); // keep running until killed
} else {
  console.log('DL|1000|1000|NA|100|0');
  const audio = args.includes('-x');
  const out = path.join(home, audio ? 'Fake Title [abc].mp3' : 'Fake Title [abc].mp4');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(out, 'x'.repeat(1000));
  console.log('FINAL|' + out);
  process.exit(0);
}
