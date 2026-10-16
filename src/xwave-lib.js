'use strict';

/**
 * Exit plumbing shared by the pool-driven scripts.
 *
 * The tools learned the hard way that raw free-exit lists are useless for a
 * multi-step mint: `register`/`login` answers arrive, but `checkin` and `/v1/models`
 * exhaust 5-6 retries on dead candidates. So every script first **collects**
 * candidates (pool-proven exits for the host first, screened local lists behind)
 * and then **screens** them with a real HTTP request against the panel's own
 * `/api/status`, keeping only exits that answer.
 */

const http = require('http');
const path = require('path');
const { loadExits, req } = require('./lib');
const { parseProxy } = require(path.join(__dirname, 'proxy'));

const O = (...p) => path.join(__dirname, '..', ...p);

const DEFAULT_LISTS = [
  path.join(__dirname, 'proxies.txt'), // rewritten by the pool every round, `# proven=<host>` tagged
  path.join(__dirname, 'proxies.txt'),
  path.join(__dirname, 'proxies.txt'),
  path.join(__dirname, 'proxies.txt'),
  path.join(__dirname, 'proxies.txt'),
  path.join(__dirname, 'proxies.txt'),
  path.join(__dirname, 'proxies.txt'),
];

function poolGet(url) {
  return new Promise((resolve, reject) => {
    const r = http.get(url, { timeout: 20000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('pool json'));
        }
      });
    });
    r.setTimeout(20000, () => r.destroy(new Error('pool timeout')));
    r.on('error', reject);
  });
}

/**
 * Ordered, deduped candidate list: pool-proven exits for `host` at the head,
 * screened local lists behind. `log` is optional.
 */
async function collectCandidates({ host, pool = 'http://127.0.0.1:8791', poolLimit = 60, lists = DEFAULT_LISTS, extra = [], noPool = false, log = () => {} } = {}) {
  const lines = [];
  if (!noPool && host) {
    for (const fresh of ['only', 'any']) {
      try {
        const doc = await poolGet(`${pool}/pool?target=${encodeURIComponent(host)}&limit=${poolLimit}&fresh=${fresh}`);
        const ex = doc.exits || [];
        lines.push(...ex.map((e) => `${e.protocol}://${e.line}`));
        log(`pool(${fresh}): ${ex.length} exit(s) for ${host} (fresh ${ex.filter((e) => e.fresh).length})`);
        if (fresh === 'only' && ex.length >= 12) break;
      } catch (e) {
        log(`pool(${fresh}) unavailable: ${String(e.message).slice(0, 80)}`);
        break;
      }
    }
  }
  const seen = new Set();
  const head = [];
  const tail = [];
  const push = (arr, p) => {
    if (!p) return;
    const id = `${p.host}:${p.port}`;
    if (seen.has(id)) return;
    seen.add(id);
    p.connectTimeoutMs = 8000;
    p.timeoutMs = 32000;
    p.line = `${p.protocol}://${p.host}:${p.port}`;
    arr.push(p);
  };
  for (const l of lines) push(head, parseProxy(l));
  for (const p of loadExits([...lists, ...extra], { shuffle: true })) push(tail, p);
  head.sort(() => Math.random() - 0.5);
  return { candidates: [...head, ...tail], poolCount: head.length };
}

/**
 * Keep only exits that answer `GET <base>/api/status` with 200 + a panel body.
 * Stops as soon as `want` are found or `budgetMs` runs out; ≤`conc` sockets live.
 *
 * `check` replaces the default panel probe with an arbitrary predicate — used by
 * the captcha handoff, where an exit must reach the panel *and* the captcha CDN
 * before a widget page can even render.
 */
async function screenFor(base, candidates, { want = 6, conc = 4, budgetMs = 240000, min = 0, log = () => {}, check = null } = {}) {
  const good = [];
  const queue = [...candidates];
  const t0 = Date.now();
  let tried = 0;
  const probe = check || (async (p) => {
    const res = await req(p, `${base}/api/status`, { timeoutMs: 20000, connectTimeoutMs: 6000, headers: { accept: 'application/json' } });
    return res.status === 200 && /system_name/.test(res.text);
  });
  await Promise.all(
    Array.from({ length: Math.min(conc, Math.max(queue.length, 1)) }, async () => {
      while (queue.length && good.length < want && Date.now() - t0 < budgetMs) {
        const p = queue.shift();
        tried++;
        try {
          if (await probe(p)) {
            good.push(p);
            log(`  ✓ screened ${p.line}`);
          }
        } catch (e) {
          /* dead candidate — expected on free exits */
        }
      }
    })
  );
  log(`screen: ${good.length} working exit(s) from ${tried} tried in ${Math.round((Date.now() - t0) / 1000)}s`);
  const goodIds = new Set(good.map((p) => p.line));
  const rest = candidates.filter((p) => !goodIds.has(p.line));
  if (min && good.length < min) log(`screen: below min (${good.length} < ${min}) — proceeding with fallbacks in the tail`);
  return { exits: [...good, ...rest], good, tried };
}

/** Accepts a mix of proxy lines and parsed proxies; returns parsed proxies only. */
function toProxies(list) {
  const out = [];
  for (const item of list || []) {
    if (!item) continue;
    const p = typeof item === 'string' ? parseProxy(item) : item;
    if (!p) continue;
    p.connectTimeoutMs = p.connectTimeoutMs || 8000;
    p.timeoutMs = p.timeoutMs || 32000;
    p.line = p.line || `${p.protocol}://${p.host}:${p.port}`;
    out.push(p);
  }
  return out;
}

module.exports = { collectCandidates, screenFor, poolGet, toProxies, DEFAULT_LISTS, O };
