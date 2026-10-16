#!/usr/bin/env node
'use strict';

/**
 * yjs keys authenticate (200) but serve nothing: the account's group `default`
 * has no channels (`{"data":[]}` + `No available channel … under group default`).
 * The pricing page lists Free-group models (`deepseek-v4.1-flash`, `hy3`, …).
 * This probe sets ONE token's group to `Free` (token group overrides are a
 * standard fork knob), re-reads `/v1/models` and then chats the cheapest listed
 * model — if it works, the same stamp is applied to the sibling tokens.
 *
 *   node src/probe-group.js
 */

const fs = require('fs');
const path = require('path');
const { req, writeJson, nowIso, isExitError } = require('./lib.js');
const { collectCandidates, screenFor } = require('./xwave-lib.js');
const { Panel, UA } = require('./newapi.js');

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
  const rec = require(path.join(DIR, 'accounts.json')).filter((a) => a.status === 'minted')[0];
  if (!rec) throw new Error('no minted account');
  const { candidates } = await collectCandidates({ host: 'api.yjs.im', log: (m) => console.log('· ' + m) });
  const { exits } = await screenFor(BASE, candidates, { want: 4, conc: 3, budgetMs: 120000, log: (m) => console.log('· ' + m) });
  const rot = new Rot(exits);
  const panel = new Panel(BASE, rot, { log: (m) => console.log('  ' + m) });
  const login = await panel.login({ username: rec.username, password: rec.password, tries: 8 });
  console.log(`login ${login.status} success=${login.json && login.json.success} user.group=${login.json && login.json.data && login.json.data.user && login.json.data.user.group}`);
  const list = await panel.listTokens(8);
  const mine = (list.items || []).find((t) => t.id) || null;
  if (!mine) throw new Error('no token');
  console.log(`token#${mine.id} name=${mine.name} group=${JSON.stringify(mine.group)} quota=${mine.remain_quota}/${mine.unlimited_quota}`);
  const out = { at: nowIso(), account: rec.username, userGroup: login.json && login.json.data && login.json.data.user && login.json.data.user.group, tokenBefore: { id: mine.id, group: mine.group }, calls: [] };

  const putBody = { id: mine.id, name: mine.name, remain_quota: 0, expired_time: -1, unlimited_quota: true, model_limits_enabled: false, model_limits: '', allow_ips: '', group: 'Free', status: 1 };
  const upd = await rot.attempt(async (p) => {
    const res = await req(p, BASE + '/api/token/', {
      method: 'PUT',
      body: putBody,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA, cookie: panel.cookie, authorization: `Bearer ${panel.accessToken}` },
      timeoutMs: 30000,
    });
    return { status: res.status, text: res.text.slice(0, 300), exit: p.line };
  });
  out.calls.push({ name: 'PUT group=Free', ...upd });
  console.log(`PUT group=Free → ${upd.status} ${upd.text.slice(0, 180)}`);

  const key = rec.key;
  const models = await panel.models(key, { tries: 8 });
  out.calls.push({ name: 'GET /v1/models (group Free)', status: models.status, text: models.text.slice(0, 400), exit: models.exit });
  const ids = models.json && Array.isArray(models.json.data) ? models.json.data.map((m) => m.id) : [];
  console.log(`models → ${models.status} n=${ids.length} ${ids.slice(0, 8).join(', ')}`);
  if (ids.length) {
    const pick = ids.find((id) => /flash|free|lite|mini/i.test(id)) || ids[0];
    const chat = await panel.chat(key, pick, { tries: 8, timeoutMs: 90000 });
    out.calls.push({ name: `chat ${pick}`, status: chat.status, text: (chat.json ? JSON.stringify(chat.json) : String(chat.text)).slice(0, 400), exit: chat.exit });
    console.log(`chat ${pick} → ${chat.status} ${(chat.json ? JSON.stringify(chat.json) : chat.text).slice(0, 200)}`);
    if (chat.status === 200) out.ok = true;
  }
  writeJson(path.join(DIR, 'out', 'group-probe.json'), out);
  console.log('→ out/group-probe.json');
  process.exit(out.ok ? 0 : 3);
})().catch((e) => {
  console.error('group probe failed:', e.message);
  process.exit(1);
});
