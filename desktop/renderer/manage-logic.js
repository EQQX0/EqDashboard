'use strict';
// Pure helpers for the VPS, My PC and Files screens. Loaded by the page as a plain script and by main.js and the tests via require().
// The rules mirror agent/vps.js, agent/pc.js and agent/files.js so mistakes show up before a request is sent.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ManageLogic = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const VPS_NAME_RE = /^[a-z]([a-z0-9-]{0,21}[a-z0-9])?$/;
  const SSH_KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/]{20,2000}={0,2}( [A-Za-z0-9@._-]{1,60})?$/;
  const PC_USER_RE = /^[A-Za-z0-9._-]{1,32}$/;
  const MAC_RE = /^([0-9a-f]{2})([:-]?)([0-9a-f]{2})(?:\2[0-9a-f]{2}){4}$/i;
  // Cloudflare refuses request bodies over 100 MB on the free plan, so stop there even though the agent accepts more.
  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

  function validateVpsName(raw) {
    const n = String(raw == null ? '' : raw).trim();
    if (!n) return 'Enter a name';
    if (!VPS_NAME_RE.test(n)) return 'Use 1-23 lowercase letters, numbers or hyphens, starting with a letter';
    return '';
  }
  // The key is optional. Empty is fine.
  function validateSshKey(raw) {
    const k = String(raw == null ? '' : raw).trim();
    if (!k) return '';
    return SSH_KEY_RE.test(k) ? '' : 'That does not look like a public SSH key (ssh-ed25519 AAAA...)';
  }

  function normMac(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const hex = s.replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (!MAC_RE.test(s) || hex.length !== 12) return null;
    return hex.match(/../g).join(':');
  }
  function isPrivateV4(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip));
    if (!m) return false;
    const p = m.slice(1).map(Number);
    if (p.some((x) => x > 255)) return false;
    return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  function validatePcName(raw) {
    const n = String(raw == null ? '' : raw).trim();
    if (!n) return 'Enter a name';
    return n.length > 40 ? 'Use 40 characters or fewer' : '';
  }
  function validateMac(raw) { return normMac(raw) ? '' : 'Use the format AA:BB:CC:DD:EE:FF'; }
  function validateIp(raw) { return isPrivateV4(String(raw || '').trim()) ? '' : "Use the PC's local address, like 192.168.1.20"; }
  // required = true for the Set Windows user dialog; the Add form allows an empty user.
  function validatePcUser(raw, required) {
    const u = String(raw == null ? '' : raw).trim();
    if (!u) return required ? 'Enter the Windows user name' : '';
    return PC_USER_RE.test(u) ? '' : 'Use letters, numbers, dot, dash or underscore (up to 32)';
  }
  function validatePort(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (s === '') return '';
    const n = Number(s);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? '' : 'Port must be 1-65535';
  }
  // EqRGB remote link, e.g. http://192.168.0.174:47822/?t=TOKEN. Must point at the PC. Empty clears it.
  function validateLightsUrl(raw, ip) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    let u;
    try { u = new URL(text); } catch { return 'That is not a link'; }
    const t = u.searchParams.get('t');
    if (text.length > 400 || u.protocol !== 'http:' || u.hostname !== ip || !t || t.length < 8 || u.username || u.password) {
      return `Use the EqRGB phone-remote link for this PC (http://${ip}:port/?t=...)`;
    }
    return '';
  }

  // One file or folder name (agent validName).
  function validateEntryName(raw) {
    const n = String(raw == null ? '' : raw);
    if (!n.trim()) return 'Enter a name';
    if (/[\/\\\0]/.test(n) || n === '.' || n === '..') return 'A name cannot contain slashes';
    if (new TextEncoder().encode(n).length > 255) return 'That name is too long';
    if (n.includes(':')) return 'A name cannot contain a colon';
    if (n.endsWith('.part')) return 'Names ending in .part are reserved';
    return '';
  }
  // Remote folder path as the agent expects it: relative, forward slashes, no dot segments.
  function validateRemoteDir(p) {
    if (typeof p !== 'string') return false;
    if (p === '') return true;
    if (p.length > 4096 || /[\\\0]/.test(p) || p.startsWith('/')) return false;
    return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
  }
  const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);

  const VPS_ERRORS = {
    bad_name: 'Use 1-23 lowercase letters, numbers or hyphens, starting with a letter',
    bad_distro: 'Choose a Linux version',
    bad_key: 'That does not look like a public SSH key',
    exists: 'A slice with that name already exists',
    too_many: 'You have reached the slice limit',
    not_found: 'That slice was not found',
    busy: 'That slice is busy, try again in a moment',
    wrong_state: 'The slice is not in the right state for that',
    key_only: 'This slice only accepts SSH keys, so it has no password',
    engine_missing: 'The VPS engine is not installed on the server',
    low_space: 'Not enough free storage on the phone',
  };
  const PC_ERRORS = {
    bad_name: 'Enter a name up to 40 characters',
    bad_mac: 'Use the format AA:BB:CC:DD:EE:FF',
    bad_ip: "Use the PC's local address, like 192.168.1.20",
    bad_user: 'Use letters, numbers, dot, dash or underscore (up to 32)',
    bad_port: 'Port must be 1-65535',
    exists: 'A PC with that MAC address is already added',
    too_many: 'You have reached the PC limit',
    not_found: 'That PC was not found',
    no_ssh_user: 'Set the Windows user first',
    bad_link: 'That is not the EqRGB link for this PC',
    no_lights: 'Save the lights link first',
    auth_failed: 'The PC refused the server key. Finish the shutdown setup on the PC',
    unreachable: 'The PC did not answer. Is it on and on the same network?',
    ssh_missing: 'ssh is not installed on the server',
    ssh_failed: 'The shutdown command failed',
    send_failed: 'Could not send the wake signal',
  };
  const FILE_ERRORS = {
    bad_path: 'That name or location is not allowed',
    exists: 'Something with that name already exists',
    not_found: 'That item was not found. It may already be gone',
    busy: 'The server is busy with another change. Try again in a moment',
    too_large: 'Too big. Cloudflare allows 100 MB per upload',
    file_unreadable: 'Could not read that file',
    is_a_directory: 'That is a folder',
  };
  const UPDATE_ERRORS = {
    busy: 'An update is already running',
    not_found: 'This server is too old to update from here. Update it from the phone once',
    bad_checksum: 'The downloaded update failed its checksum. Try again later',
    bad_archive: 'The update archive was not valid. Try again later',
    rate_limited: 'GitHub is limiting requests. Try again later',
    github_error: 'Could not read the release from GitHub',
    network: 'The server could not reach GitHub',
  };
  const pick = (map, code, fallback) => {
    const c = String(code == null ? '' : code);
    return Object.prototype.hasOwnProperty.call(map, c) ? map[c] : (c || fallback || 'Action failed');
  };
  const vpsErrorText = (c, f) => pick(VPS_ERRORS, c, f);
  const pcErrorText = (c, f) => pick(PC_ERRORS, c, f);
  const filesErrorText = (c, f) => pick(FILE_ERRORS, c, f);
  const updateErrorText = (c, f) => pick(UPDATE_ERRORS, c, f);

  // Text for the update panel from a GET agent/update answer.
  function updateSummary(info) {
    if (!info || !info.current) return 'Version unknown';
    if (!info.latest) return `Version ${info.current}. No agent release found`;
    if (info.available) return `Version ${info.current}. Version ${info.latest} is available`;
    return `Version ${info.current}. Up to date`;
  }

  return {
    MAX_UPLOAD_BYTES, VPS_NAME_RE, SSH_KEY_RE,
    validateVpsName, validateSshKey, normMac, isPrivateV4, validatePcName, validateMac, validateIp, validatePcUser, validatePort,
    validateLightsUrl, validateEntryName, validateRemoteDir, joinPath,
    vpsErrorText, pcErrorText, filesErrorText, updateErrorText, updateSummary,
  };
}));
