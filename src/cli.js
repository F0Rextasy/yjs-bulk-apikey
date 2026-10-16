#!/usr/bin/env node
'use strict';

/**
 * Command dispatcher for yjs-bulk-apikey.
 *
 *   node src/cli.js mint     create fresh accounts and mint one key each
 *   node src/cli.js help
 *
 * Every task spawns the matching module in this folder, so a crash in one run
 * never leaves state behind in this process.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const TASKS = {
  mint: { file: 'mint.js', note: 'create fresh accounts and mint one key each' },
  connect: { file: 'connect-9router.js', note: 'register the provider node + one API key with a local 9Router' },
};

function help() {
  console.log('yjs-bulk-apikey — One yjs account per API key — captcha-free signup, live-verified, any number you want.\n');
  console.log('usage: node src/cli.js <task> [options]\n');
  console.log('tasks:');
  for (const [name, t] of Object.entries(TASKS)) console.log('  ' + name.padEnd(9) + ' ' + t.note);
  console.log('\noptions: every task takes its own flags — ask it directly:');
  console.log('  node src/<task-file> --help');
  console.log('\nproxy pool:');
  console.log('  one exit per line in proxies.txt — scheme://host:port[#comment], user:pass@ supported');
  console.log('\n9Router (optional, local inference router):');
  console.log('  node src/cli.js connect --api-key <key>        register node + key (node src/connect-9router.js --help)');
  console.log('  node src/cli.js --connect-9router --api-key <key>   the same task');
  console.log('\nno options? run the interactive launcher:  node src/launcher.js');
}

const argv = process.argv.slice(2);
const task = argv[0] === '--connect-9router' ? 'connect' : argv[0];
if (!task || task === 'help' || task === '--help' || task === '-h') {
  help();
  process.exit(0);
}
const entry = TASKS[task];
if (!entry) {
  console.error('unknown task: ' + task + '\n');
  help();
  process.exit(1);
}
const child = spawnSync(process.execPath, [path.join(__dirname, entry.file), ...argv.slice(1)], {
  windowsHide: true,
  stdio: 'inherit',
  env: process.env,
});
process.exit(child.status === null ? 1 : child.status);
