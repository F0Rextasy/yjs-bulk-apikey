'use strict';

/**
 * Per-provider CLI: every provider folder has a `config.json` describing how it
 * is minted, and a 3-line `src/mint.js` shim that calls this file. That keeps
 * the engines shared (one place to fix bugs) while each provider folder stays
 * self-contained and re-runnable — the rule for shipping a provider.
 *
 *   node src/provider-cli.js --name kuaipao [--count 3] [--mail emailnator] …
 *
 * config.json:
 *   {
 *     "name": "kuaipao", "base": "https://kuaipao.ai", "tag": "kp",
 *     "engine": "newapi-node" | "newapi-browser" | "script",
 *     "mail": "mailtrap" | "emailnator",
 *     "pools": ["proxies.txt"],
 *     "args": { "no-checkin": true, "headless": true, "port": 9870 }
 *   }
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const one = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const NAME = one('name');
if (!NAME) {
  console.error('usage: provider-cli.js --name <provider> [--count N] [--pool f] [engine flags]');
  process.exit(1);
}

const DIR = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));

const ENGINE = {
  'newapi-node': 'mint-newapi.js',
  'newapi-pinned': 'mint-newapi-pinned.js',
  'newapi-browser': 'mint-newapi-browser.js',
  'browser-generic': 'mint-browser-generic.js',
}[cfg.engine || 'newapi-node'];

if (!ENGINE) {
  console.error(`unknown engine ${cfg.engine} for ${NAME}`);
  process.exit(1);
}

// config args first, then whatever the caller passed (caller wins by position:
// engines read a flag's *first* occurrence after --name/--base are fixed)
const extra = [];
for (const [k, v] of Object.entries(cfg.args || {})) {
  if (v === true) extra.push(`--${k}`);
  else if (v === false || v === null || v === undefined) continue;
  else extra.push(`--${k}`, String(v));
}
const forwarded = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--name' || argv[i] === '--config') continue;
  forwarded.push(argv[i]);
}

process.argv = [
  process.argv[0],
  path.join(__dirname, ENGINE),
  '--name',
  cfg.name || NAME,
  '--base',
  cfg.base,
  '--tag',
  cfg.tag || NAME,
  '--folder',
  cfg.folder || `${NAME}-bulk`,
  '--mail',
  one('mail', cfg.mail || 'mailtrap'),
  ...(cfg.pools || []).flatMap((p) => ['--pool', p]),
  ...(cfg.mailPools || []).flatMap((p) => ['--mail-pool', p]),
  ...extra,
  ...forwarded,
];

require(path.join(__dirname, ENGINE));
