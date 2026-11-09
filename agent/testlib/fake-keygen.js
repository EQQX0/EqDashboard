// Stand-in for ssh-keygen: writes <file> and <file>.pub for `-f <file>`.
'use strict';
const fs = require('fs');
const f = process.argv[process.argv.indexOf('-f') + 1];
fs.writeFileSync(f, 'PRIVATE');
fs.writeFileSync(f + '.pub', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKEKEYFORTESTSONLY1234567890abcdef s21-agent\n');
