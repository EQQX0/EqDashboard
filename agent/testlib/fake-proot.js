// Stand-in for proot-distro in tests. State lives in FAKE_PROOT_STATE (a folder of marker files).
// FAKE_PROOT_FAIL = list | install | setup makes that step fail.
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');

const state = process.env.FAKE_PROOT_STATE;
const fail = process.env.FAKE_PROOT_FAIL || '';
const [cmd, ...rest] = process.argv.slice(2);
fs.mkdirSync(state, { recursive: true });
const marker = (a) => path.join(state, a);

if (cmd === 'list') {
  process.exit(fail === 'list' ? 1 : 0);
} else if (cmd === 'install') {
  const i = rest.indexOf('--override-alias');
  const alias = rest[i + 1];
  if (fail === 'install') { console.error('download failed'); process.exit(1); }
  fs.writeFileSync(marker(alias), JSON.stringify({ distro: rest[rest.length - 1], passwords: [] }));
  process.exit(0);
} else if (cmd === 'remove') {
  try { fs.rmSync(marker(rest[0])); } catch { /* absent */ }
  process.exit(0);
} else if (cmd === 'login') {
  const alias = rest[0];
  if (!fs.existsSync(marker(alias))) { console.error('not installed'); process.exit(1); }
  const dash = rest.indexOf('--');
  const sh = rest.slice(dash + 1);
  if (sh.includes('-c')) {
    // start script: listen on the sshd port like sshd -D would
    const m = /-p (\d+)/.exec(sh[sh.indexOf('-c') + 1]);
    const srv = net.createServer((s) => { s.on('error', () => {}); s.end('SSH-2.0-fake\r\n'); });
    srv.listen(Number(m[1]), '127.0.0.1');
    process.on('SIGTERM', () => srv.close(() => process.exit(0)));
    setInterval(() => {}, 1000);
  } else {
    let data = '';
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => {
      if (fail === 'setup') { console.error('E: Unable to locate package'); process.exit(100); }
      const pw = /root:([^']+)'/.exec(data);
      const meta = JSON.parse(fs.readFileSync(marker(alias), 'utf8'));
      if (pw) meta.passwords.push(pw[1]);
      meta.script = data;
      fs.writeFileSync(marker(alias), JSON.stringify(meta));
      console.log('s21-setup-done');
    });
  }
} else {
  process.exit(2);
}
