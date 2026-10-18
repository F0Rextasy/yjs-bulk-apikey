#!/usr/bin/env node
'use strict';

/**
 * Interactive launcher for yjs-bulk-apikey — a menu over the task modules.
 * Settings persist in launcher.config.json next to this file.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const CONFIG = path.join(HERE, 'launcher.config.json');
const POOL = path.join(HERE, 'proxies.txt');
const KEYS = path.join(HERE, 'keys.txt');

const defaults = { count: 30, conc: 2 };
let cfg = { ...defaults };
try { Object.assign(cfg, JSON.parse(fs.readFileSync(CONFIG, 'utf8'))); } catch (e) {}
const save = () => fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
const ARGS = {"mint":[]};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, fb) => new Promise((r) => rl.question(q + (fb !== undefined ? ' [' + fb + ']' : '') + ': ', (a) => r(String(a).trim() || fb)));
// same as ask(), but nothing that is typed is echoed — the prompt stays visible, the key never does
const askSecret = (q) => new Promise((resolve) => {
  const write = rl._writeToOutput;
  const prompt = q + ': ';
  rl._writeToOutput = function (s) {
    if (s === prompt) rl.output.write(s);
    else if (s === '\r\n' || s === '\n') rl.output.write('\n');
  };
  rl.question(prompt, (a) => {
    rl._writeToOutput = write;
    resolve(String(a).trim());
  });
});

const LOGO = String.raw`
  ██╗   ██╗   ██╗███████╗
  ╚██╗ ██╔╝   ██║██╔════╝
   ╚████╔╝    ██║███████╗
    ╚██╔╝██   ██║╚════██║
     ██║ ╚█████╔╝███████║
     ╚═╝  ╚════╝ ╚══════╝`;

function banner() {
  const text = ['yjs-bulk-apikey  ·  One yjs account per API key — captcha-free signup, live-verified, any number you want.', 'MIT  ·  OpenAI-compatible  ·  9Router connector'];
  const w = Math.max(78, Math.max(...LOGO.split('\n').map((l) => [...l].length)) - 4, ...text.map((l) => l.length));
  const box = (s) => '  │ ' + s.padEnd(w) + ' │';
  console.log(LOGO);
  console.log('  ┌' + '─'.repeat(w + 2) + '┐');
  for (const line of text) console.log(box(line));
  console.log('  └' + '─'.repeat(w + 2) + '┘');
  console.log('');
}

const count = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length; } catch (e) { return 0; } };

function run(args) {
  console.log('\n▶ node ' + args.join(' ') + '\n');
  const r = spawnSync(process.execPath, args, { windowsHide: true, cwd: HERE, stdio: 'inherit' });
  if (r.status !== 0) console.log('\n⚠ exited with code ' + r.status);
}

function argsFor(task) {
  const spec = ARGS[task] || [];
  return spec.map((v) => (v === 'count' ? String(cfg.count) : v === 'conc' ? String(cfg.conc) : v));
}

async function settings() {
  console.log('\nSettings');
  console.log('  1) count      ' + cfg.count);
  console.log('  2) conc       ' + cfg.conc);
  console.log('  0) back');
  const p = await ask('choose', '0');
  if (p === '1') cfg.count = parseInt(await ask('count', cfg.count), 10) || cfg.count;
  if (p === '2') cfg.conc = parseInt(await ask('concurrency', cfg.conc), 10) || cfg.conc;
  save();
}

async function connectFlow() {
  console.log('\n9Router — register this provider node and one API key with a local 9Router instance');
  const base = await ask('9Router base URL', 'http://localhost:20128');
  const password = await ask('9Router password', '123456');
  const apiKey = await askSecret('API key to register (blank = skip)');
  if (!apiKey) {
    console.log('  no key given — nothing to register');
    return;
  }
  const name = await ask('connection label', 'yjs.im');
  const model = await ask('default model', 'deepseek-v4-flash-0731');
  process.env.NINEROUTER_API_KEY = apiKey;
  run(['connect-9router.js', '--base', base, '--password', password, '--name', name, '--model', model]);
}

async function main() {
  process.stdout.write('\x1b[2J\x1b[H');
  banner();
  console.log('  proxy exits: ' + (count(POOL) || 'none — put exits in proxies.txt') + '     keys on disk: ' + count(KEYS) + '\n');
  console.log('  1) mint      create fresh accounts and mint one key each');
  console.log('  2) Settings');
  console.log('  3) 9Router   register a key with a local 9Router instance (asks for base/password/key)');
  console.log('  0) Exit\n');
  const choice = await ask('choose', '1');
  if (choice === '1') {
    run(['mint.js', ...argsFor('mint')]);
  }
  else if (choice === '2') {
    await settings();
  }
  else if (choice === '3') {
    await connectFlow();
  } else {
    rl.close();
    return;
  }
  await ask('\npress enter for the menu', '');
  return main();
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Interactive launcher: run `node src/launcher.js` and pick a menu item.');
  process.exit(0);
}

if (process.argv.includes('--connect-9router')) {
  connectFlow()
    .then(() => rl.close())
    .catch((e) => { console.error('launcher failed:', e.stack || e.message); process.exit(1); });
} else {
  main().catch((e) => { console.error('launcher failed:', e.stack || e.message); process.exit(1); });
}
