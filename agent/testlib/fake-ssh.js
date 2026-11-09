// Stand-in for ssh in tests. FAKE_SSH_LOG gets the argv; FAKE_SSH_MODE = ok | auth | refused.
'use strict';
const fs = require('fs');
fs.writeFileSync(process.env.FAKE_SSH_LOG, JSON.stringify(process.argv.slice(2)));
const mode = process.env.FAKE_SSH_MODE || 'ok';
if (mode === 'auth') { console.error('me@host: Permission denied (publickey).'); process.exit(255); }
if (mode === 'refused') { console.error('ssh: connect to host 10.0.0.5 port 22: Connection refused'); process.exit(255); }
process.exit(0);
