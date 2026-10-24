#!/usr/bin/env node
'use strict';

/**
 * yjs-bulk-apikey · mint — the entry point the README and the launcher drive
 * (`node src/mint.js`, `node src/cli.js mint`, launcher item 1).
 *
 * The flow itself lives in the engine next to this file (send the verification
 * mail, read the code out of a fresh mailbox, register, log in, check in, create
 * the key, verify it live). This file pins the provider's settings, points the
 * engine's "provider folder" lookup at this directory — so keys.txt,
 * accounts.json and out/ land next to the code, where the launcher, the probes
 * and the README look for them — and hands the caller's flags to the engine.
 *
 *   node src/cli.js mint                       # 30 keys, exits from proxies.txt
 *   node src/cli.js mint --count 5 --conc 2    # any number, two accounts at a time
 *   node src/cli.js mint --mail imap           # read the code from a real mailbox
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.yjs.im';
const TAG = 'yjs';
const POOL = path.join(__dirname, 'proxies.txt');
// Measured sender of the panel's own verification mail: a shared mailbox carries
// other services' codes, and submitting one of those burns the cycle (the panel
// answers "code incorrect or expired" while the real mail is still in flight).
const SENDER = 'xunqian0818';
// The panel's measured shape: it hands out its mail a few seconds after the send,
// the code lives long enough for a slow exit, and a dead exit is retried twice.
const DEFAULTS = { count: '30', 'poll-ms': '2000', 'code-wait': '300000', 'max-cycle': '3', scan: '140' };

const USAGE = `yjs-bulk-apikey · mint — one yjs.im account per key, live-verified

usage: node src/cli.js mint [options]

  --count N        keys to mint (default ${DEFAULTS.count})
  --auto           captcha step automatic — DEFAULT, always on (no token on this rail)
  --pool FILE      exit list, one per line (default proxies.txt) — optional
  --mail MODE      emailnator (default) | imap — imap needs --imap-user/--imap-pass
  --imap-user U    mailbox account for --mail imap (or IMAP_USER)
  --imap-pass P    mailbox password for --mail imap (or IMAP_PASS)
  --mail-address A fixed alias for --mail imap instead of one per account
  --sender REGEX   sender the verification mail must match (default: the panel's own)
  --model ID       model probed after the mint (default: the cheapest one listed)
  --scan N         exit candidates probed per pinned exit (default ${DEFAULTS.scan})
  --scan-conc N    exits probed at once, max 8
  --poll-ms N      mailbox poll cadence (default ${DEFAULTS['poll-ms']})
  --code-wait N    how long to wait for the verification mail (default ${DEFAULTS['code-wait']})
  --max-cycle N    cycles per account — a dead exit is retried on a fresh one (default ${DEFAULTS['max-cycle']})
  --budget N       wall-clock ceiling in seconds for the whole run
  --base URL       panel address (default ${BASE})
  --preset NAME    turbo (5 accounts at a time, 3 s apart) | balanced (4/6) | safe (2/8)
  --conc N         accounts minted at a time (explicit flag wins over --preset)
  --gap S          seconds between account starts inside a worker
  --help           this text

One exit is pinned per account when a pool is provided and held for that
account's whole life; a dead line fails the attempt instead of falling back to a
direct connection. With no pool at all the run goes direct and says so.

A key whose live gate fails is not dropped: it leaves keys.txt and is written to
keys-dead.txt so a later run can re-check it.`;

const argv = process.argv.slice(2);
const one = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const eq = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const MAIL = one('mail') || eq('mail') || 'emailnator';
if (MAIL === 'emailnator' && !fs.existsSync(path.join(__dirname, 'vendor', 'emailnator.js'))) {
  console.error(
    `--mail ${MAIL} reads the code through src/vendor/emailnator.js, which this repository does not ship.\n` +
      'Use --mail imap with IMAP_USER/IMAP_PASS (any mailbox + app password; the alias per account is built for you),\n' +
      'or drop that module in at src/vendor/emailnator.js.'
  );
  process.exit(2);
}

const count = parseInt(one('count') || eq('count') || DEFAULTS.count, 10);
if (!Number.isFinite(count) || count < 1) {
  console.error(`--count takes a positive integer (got ${JSON.stringify(one('count') || eq('count'))})`);
  process.exit(2);
}

const poolArg = one('pool') || eq('pool') || POOL;
const pool = path.resolve(__dirname, poolArg);
const exits = (() => {
  try {
    return fs.readFileSync(pool, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  } catch (e) {
    return [];
  }
})();
if (!exits.length) {
  // No pool = DIRECT mode: a proxy is recommended at scale (per-IP limits, bans),
  // but the tool works without one. `null` is the direct sentinel the engine's
  // loader hands to the request layer.
  console.log(`no proxy list at ${pool} — running WITHOUT a proxy (direct). Put exits there (or pass --pool) to rotate per account.`);
}

// keys.txt, accounts.json, models.json and out/ live next to these tools, so the
// engine's "provider folder" is this directory (not src/providers/<name>).
const lib = require('./lib.js');
lib.providerDir = () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  return __dirname;
};

// The caller's flags go first — the engine reads a flag's *first* occurrence —
// and the pinned settings follow, so anything the caller left out is filled in.
process.argv = [
  process.argv[0],
  path.join(__dirname, 'mint-newapi-pinned.js'),
  ...argv,
  '--name',
  'yjs',
  '--base',
  BASE,
  '--tag',
  TAG,
  '--mail',
  MAIL,
  // The pool is handed over only when the file is really there: with no file at
  // all the engine keeps its own screened lists (or runs direct and says so).
  ...(exits.length ? ['--pool', poolArg, '--mail-pool', poolArg] : []),
  ...(SENDER ? ['--sender', SENDER] : []),
  ...Object.entries(DEFAULTS).flatMap(([k, v]) => [`--${k}`, v]),
];

console.log(`yjs · ${count} key(s) · ${exits.length || 'direct'} exit(s) from ${path.basename(pool)} · keys land in keys.txt · unverified keys → keys-dead.txt`);
require(path.join(__dirname, 'mint-newapi-pinned.js'));
