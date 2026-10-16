#!/usr/bin/env node
'use strict';

/**
 * Raw relay probe for one yjs key: /v1/models body verbatim, then chat probes
 * with plausible model ids until one is not `model_not_found`, plus the
 * authless /api/pricing list the panel publishes (model ids live there).
 *
 *   node src/probe-verify.js
 */

const fs = require('fs');
const path = require('path');
const { req, writeJson, nowIso, isExitError } = require('./lib.js');
const { collectCandidates, screenFor } = require('./xwave-lib.js');
const { UA } = require('./newapi.js');

const BASE = 'https://api.yjs.im';
const DIR = path.join(__dirname);

class Rot {
  constructor(exits) {
    this.exits = exits;
    this.dead = new Set();
    this.i = 0;
  }
  next() {
    const alive = this.exits.filter((p) => !this.dead.has(p.line));
    if (!alive.length) throw new Error('no live exits');
    return (this.last = alive[this.i++ % alive.length]);
  }
  kill(p) {
    if (p && p.line) this.dead.add(p.line);
  }
  alive() {}
  async attempt(fn, { tries = 6, label = 'call' } = {}) {
    let last = null;
    for (let i = 0; i < tries; i++) {
      const p = this.next();
      try {
        return await fn(p, i);
      } catch (e) {
        last = e;
        this.kill(p);
        if (!isExitError(e)) throw e;
        console.log(`  ${label}: ${p.line} died (${String(e.message).slice(0, 60)})`);
      }
    }
    throw new Error(`${label}: ${String(last && last.message).slice(0, 120)}`);
  }
}

(async () => {
  const key = fs
    .readFileSync(path.join(DIR, 'keys.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0];
  if (!key) throw new Error('no key in keys.txt');

  const { candidates } = await collectCandidates({ host: 'api.yjs.im', log: (m) => console.log('· ' + m) });
  const { exits } = await screenFor(BASE, candidates, { want: 4, conc: 3, budgetMs: 120000, log: (m) => console.log('· ' + m) });
  const rot = new Rot(exits);
  const out = { at: nowIso(), base: BASE, key: key.slice(0, 10) + '…', calls: [] };
  const record = (name, r) => {
    out.calls.push({ name, ...r });
    console.log(`${name} → ${r.status} ${String(r.text).slice(0, 220)}`);
  };

  // 1) raw /v1/models
  record(
    'GET /v1/models',
    await rot.attempt(async (p) => {
      const res = await req(p, BASE + '/v1/models', { headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': UA }, timeoutMs: 30000 });
      return { status: res.status, text: res.text.slice(0, 1500), exit: p.line };
    })
  );

  // 2) chat probes with plausible ids
  for (const model of ['gpt-4o-mini', 'deepseek-chat', 'gemini-2.5-flash', 'gpt-3.5-turbo']) {
    let r = null;
    try {
      r = await rot.attempt(async (p) => {
        const res = await req(p, BASE + '/v1/chat/completions', {
          method: 'POST',
          body: { model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 8 },
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
          timeoutMs: 60000,
        });
        return { status: res.status, text: res.text.slice(0, 400), exit: p.line };
      });
    } catch (e) {
      r = { status: 0, text: String(e.message).slice(0, 160) };
    }
    record(`chat ${model}`, r);
    if (r.status === 200) break;
  }

  // 3) authless pricing (public model list)
  try {
    const pr = await rot.attempt(async (p) => {
      const res = await req(p, BASE + '/api/pricing', { headers: { accept: 'application/json', 'user-agent': UA }, timeoutMs: 30000 });
      return { status: res.status, text: res.text.slice(0, 4000), exit: p.line };
    });
    record('GET /api/pricing', pr);
    try {
      const j = JSON.parse(pr.text.length < 4000 ? pr.text : '{}');
      const rows = (j.data && (j.data.models || j.data)) || [];
      const ids = (Array.isArray(rows) ? rows : []).map((m) => m && (m.model_name || m.id)).filter(Boolean);
      if (ids.length) {
        out.pricingModels = ids.slice(0, 300);
        console.log(`  pricing listed ${ids.length} model(s), e.g. ${ids.slice(0, 5).join(', ')}`);
      }
    } catch (e) {}
  } catch (e) {
    record('GET /api/pricing', { status: 0, text: String(e.message).slice(0, 160) });
  }

  writeJson(path.join(DIR, 'out', 'verify-raw.json'), out);
  console.log('→ out/verify-raw.json');
})().catch((e) => {
  console.error('verify probe failed:', e.message);
  process.exit(1);
});
