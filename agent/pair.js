#!/usr/bin/env node
'use strict';
// Writes a pairing file the Samsung Server app can import. Never prints the token.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE_NAME = 'samsung-server.pair';

function parseArgs(argv) {
  const out = { url: null, out: null, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--url' || a === '--out') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else if (a.startsWith('--url=')) out.url = a.slice(6);
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function buildPairFile(url, token) {
  return JSON.stringify({ v: 1, url: String(url).replace(/\/+$/, ''), token }) + '\n';
}

function readToken(env, dir) {
  if (env.AGENT_TOKEN) return env.AGENT_TOKEN.trim();
  const file = env.TOKEN_FILE || path.join(dir, '.token');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  return null;
}

function defaultOut(home, cwd) {
  const dl = path.join(home, 'storage', 'downloads');
  return fs.existsSync(dl) && fs.statSync(dl).isDirectory()
    ? path.join(dl, FILE_NAME)
    : path.join(cwd, FILE_NAME);
}

/** Returns an exit code. Only paths and instructions go to stdout/stderr, never the token. */
function run({ argv = [], env = process.env, home = os.homedir(), cwd = process.cwd(),
  dir = __dirname, stdout = (s) => console.log(s), stderr = (s) => console.error(s) } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { stderr(e.message); return 2; }
  if (args.help) {
    stdout('Usage: node pair.js --url https://api.example.com [--out <path>] [--force]');
    stdout('The address is where your tunnel serves this agent. AGENT_PUBLIC_URL works instead of --url.');
    return 0;
  }
  const token = readToken(env, dir);
  if (!token) {
    stderr('No agent token found. Set AGENT_TOKEN, or start server.js once to create agent/.token (or set TOKEN_FILE).');
    return 1;
  }
  const url = args.url || env.AGENT_PUBLIC_URL || '';
  if (!url) {
    stderr('Say where the app reaches this agent: node pair.js --url https://api.example.com (or set AGENT_PUBLIC_URL).');
    return 2;
  }
  if (!/^https:\/\/[^/\s]+/.test(url)) {
    stderr('--url must be an https:// address.');
    return 2;
  }
  const target = path.resolve(args.out || defaultOut(home, cwd));
  try {
    fs.writeFileSync(target, buildPairFile(url, token), { mode: 0o600, flag: args.force ? 'w' : 'wx' });
    try { fs.chmodSync(target, 0o600); } catch { /* not supported on this platform */ }
  } catch (e) {
    if (e.code === 'EEXIST') stderr(`${target} already exists. Re-run with --force to overwrite it.`);
    else stderr(`Could not write ${target}: ${e.code || 'error'}`);
    return 1;
  }
  stdout(`Wrote pairing file: ${target}`);
  stdout(`Import it in the app, then delete it: rm ${target}`);
  return 0;
}

if (require.main === module) process.exitCode = run({ argv: process.argv.slice(2) });

module.exports = { parseArgs, buildPairFile, readToken, defaultOut, run };
