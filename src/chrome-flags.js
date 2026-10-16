// Shared lean launch flags for every CDP browser the toolchain opens.
//
// Measured 2026-10-14: 97 chrome.exe processes across the tool’s profiles cost
// 7.42 GB of RAM (~6.55 GB free left). Each profile spawns ~8-12 processes
// (browser + renderers + GPU + utility). Two levers matter, in this order:
//   1) fewer concurrent profiles (the biggest win by far),
//   2) lean flags per profile — GPU/utility/renderer trimming is worth ~30-40 %.
//
// Usage:  const { leanArgs } = require('./chrome-flags');
//         puppeteer.launch({ args: [...leanArgs(), '--user-data-dir=…'], … })
'use strict';

/** Flags that cut memory without touching JS execution or rendering fidelity. */
function leanArgs({ headless = false, extra = [] } = {}) {
  const args = [
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
    '--renderer-process-limit=2',
    '--js-flags=--max-old-space-size=256',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    ...extra,
  ];
  if (headless) args.push('--headless=new');
  return args;
}

/** A realistic lower bound: one browser with several isolated contexts. */
function sharedBrowserNote() {
  return [
    'Prefer ONE browser with multiple isolated contexts over one browser per account:',
    "  const { browserContextId } = await client.send('Target.createBrowserContext', { proxyServer: 'socks5://…' });",
    "  const { targetId } = await client.send('Target.createTarget', { url, browserContextId });",
    'Each context has its own cookies/proxy/UA and is invisible to the others, while the',
    'process tree (and therefore the RAM cost) is shared. Only the captcha phase truly',
    'needs a visible, dedicated window.',
  ].join('\n');
}

module.exports = { leanArgs, sharedBrowserNote };
