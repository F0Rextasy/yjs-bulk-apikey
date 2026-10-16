#!/usr/bin/env node
'use strict';

/**
 * New API fork mint — **pinned-exit** variant.
 *
 * Why this engine exists next to mint-newapi.js: a panel that answers
 * "Verification code is incorrect or has expired" *while the code was read
 * correctly from the inbox* is either exit-bound or expiry-bound, and both are
 * invisible to a flow that re-picks an exit per step. This engine:
 *
 *   1. proves ONE exit against the panel and holds it for the whole account
 *      (sendCode → read code → register → login → token → verify) through a
 *      keep-alive agent = one tunnel, one upstream address, one cookie jar;
 *   2. snapshots the mailbox *before* sendCode and only reads messages that
 *      arrived after it (Emailnator recycles addresses; the previous tenant's
 *      code produces exactly that refusal);
 *   3. polls the inbox at a short cadence and submits the register POST on the
 *      first poll that yields a code, logging `t_read`/`t_submit` relative to
 *      sendCode, so the panel's real expiry window becomes measurable;
 *   4. on a code refusal re-sends on the same exit and registers with the newest
 *      mail only (distinguishes expiry from binding);
 *   5. appends to `keys.txt` only after the provider's own `/v1/models` (and,
 *      where that is gated, a real completion) answers with that key.
 *
 * Evidence per attempt: raw inbox dump `out/inbox-<email>.json`, the exact
 * register body, the panel's verbatim answer, the exit line and the cookie seen
 * at sendCode vs register.
 *
 *   node src/mint-newapi-pinned.js --name aiaiai \
 *     --base https://api.aiaiai001.com --tag aaa --count 3 \
 *     --pool out/pool/aiaiai-live.txt --probe
 */

const fs = require('fs');
const path = require('path');

const { loadExits, ExitPool, providerDir, readJson, writeJson, appendLine, sleep, randHex, randPass, nowIso, extractCode, req, isExitError } = require('./lib');
const { Panel, gates, UA } = require('./newapi');
const { createAgent } = require(path.join(__dirname, 'proxy'));

let emailnator = null;
try {
  emailnator = require(path.join(__dirname, 'cloudflare-wai', 'emailnator.js'));
} catch (e) {
  /* reported on first use */
}

// --------------------------------------------------------------------------- cli

const argv = process.argv.slice(2);
const one = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);
const many = (name) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
  return out;
};

const NAME = one('name');
const BASE = one('base');
const TAG = one('tag', (NAME || 'x').slice(0, 12));
const COUNT = parseInt(one('count', '3'), 10);
const FOLDER = one('folder', `${NAME}-bulk`);
const CHECKIN = !has('no-checkin');
const POOLS = many('pool');
const MAIL_POOLS = many('mail-pool');
const PROBE = has('probe');
const PROBE_MAIL = has('probe-mail');
const PROBE_REGISTER = has('probe-register');
const POLL_MS = parseInt(one('poll-ms', '2500'), 10);
const CODE_WAIT_MS = parseInt(one('code-wait', '150000'), 10);
const MAX_CYCLE = parseInt(one('max-cycle', '3'), 10);
const SCAN_MAX = parseInt(one('scan', '120'), 10);
const SCAN_CONC = Math.min(parseInt(one('scan-conc', '6'), 10), 8);
const BUDGET_MS = parseInt(one('budget', '2700'), 10) * 1000;
const AFF = one('aff', '');
const OFFER_MODEL = one('model', '');
const MAIL_TRIES = parseInt(one('mail-tries', '3'), 10);
// Controls (Main, 2026-10-15): cycle 1 submits on the first poll; cycles
// >= `--delay-from-cycle` deliberately wait `--delay-ms` before the register
// POST, so "does a correct code survive 30 s of delay?" is measured, not guessed.
const DELAY_MS = parseInt(one('delay-ms', '30000'), 10);
const DELAY_FROM = parseInt(one('delay-from-cycle', '99'), 10);
// Reuse a mailbox that has demonstrably received this panel's mail before, instead
// of generating a fresh Emailnator address (its boxes receive under different
// underlying accounts; a box that already got the panel's mail is worth more).
const REUSE_BOX = one('box', '');
// Mailbox backend: `emailnator` (gmail via a shared reader, no body endpoint —
// measured) or `imap` (a real gmail/outlook mailbox you own; per-account
// `local+tag@domain` alias, real message bodies). The IMAP path is the one the
// sign-up gate work built these modules for.
const MAIL_MODE = one('mail', 'emailnator');
const IMAP_USER = one('imap-user', process.env.IMAP_USER || '');
const IMAP_PASS = one('imap-pass', process.env.IMAP_PASS || '');
const MAIL_ADDRESS = one('mail-address', '');
// Exit-class control: restrict the priority list to annotated lines labelled
// `class:<c>` (res|isp|dc) — a different egress class is the one variable.
const EXIT_CLASS = one('exit-class', '');
// Panel mail does not always come from the panel's own domain (measured
// 2026-10-15, several panels). A regex here marks such mail as panel-owned; with
// it set, foreign codes from a shared/recycled box are never submitted as the
// panel's (measured: a Magic Hour code submitted as Jasper's, refused).
const SENDER = one('sender', '');
const STRICT_SENDER = Boolean(SENDER);

if (!NAME || !BASE) {
  console.error('usage: mint-newapi-pinned.js --name <provider> --base <https://host> [--count 3] [--pool f] [--probe] [--probe-register]');
  process.exit(1);
}

const DIR = providerDir(NAME);
const PANEL_DOMAIN = (() => {
  try {
    const host = new URL(BASE).host;
    const parts = host.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : host;
  } catch (e) {
    return null;
  }
})();
const KEYS = path.join(DIR, 'keys.txt');
const ACCOUNTS = path.join(DIR, 'accounts.json');
const LOG = path.join(DIR, 'out', `pinned-${new Date().toISOString().slice(0, 10)}.log`);
const log = (...a) => {
  const line = `[${nowIso()}] ${a.join(' ')}`;
  console.log(line);
  appendLine(LOG, line);
};

const accounts = readJson(ACCOUNTS, []);
const startedAt = Date.now();
const withinBudget = () => Date.now() - startedAt < BUDGET_MS;

// --------------------------------------------------------------------------- pinned supply

/**
 * Same contract as ExitPool/LiveSupply but always hands back the pinned exit.
 * Any transport failure retires the pin (`dead`), which is what sends the
 * account back to cycle 1 with a fresh exit and a fresh code.
 */
class PinnedSupply {
  constructor(pin) {
    this.pin = pin;
    this.dead = false;
    this.calls = 0;
  }
  async next() {
    if (this.dead) throw new Error('pinned exit retired');
    return this.pin;
  }
  async attempt(fn) {
    this.calls++;
    try {
      return await fn(this.pin, 0);
    } catch (e) {
      if (isExitError(e)) this.dead = true;
      throw e;
    }
  }
  kill() {
    this.dead = true;
  }
  alive() {}
}

function pinnedPanel(pin) {
  const supply = new PinnedSupply(pin);
  const panel = new Panel(BASE, supply, { label: NAME, log });
  panel.agent = createAgent(pin, { keepAlive: true, maxSockets: 1 });
  panel.supply = supply;
  return panel;
}

/**
 * Exit hunter: screened ("priority") lists first, then the cold candidate dump.
 * An exit that answered once is remembered and re-probed before anything else —
 * free exits that answer usually keep answering for a few minutes.
 */
class PinHunter {
  constructor(priority, cold, { scanMax = SCAN_MAX, parallel = SCAN_CONC, path: probePath = '/api/status' } = {}) {
    this.priority = priority;
    this.cold = cold;
    this.dead = new Set();
    this.pIdx = 0;
    this.cIdx = 0;
    this.recent = [];
    this.scanMax = scanMax;
    this.parallel = parallel;
    this.probePath = probePath;
    this.scanned = 0;
    this.statusHist = {};
  }
  take(n) {
    const out = [];
    while (out.length < n) {
      let p = null;
      if (this.pIdx < this.priority.length) p = this.priority[this.pIdx++];
      else if (this.cIdx < this.cold.length) p = this.cold[this.cIdx++];
      else break;
      if (this.dead.has(p.line)) continue;
      out.push(p);
    }
    return out;
  }
  retire(p) {
    if (p) this.dead.add(p.line);
  }
  remember(p) {
    if (p) this.recent.unshift({ p, at: Date.now() });
  }
  async probe(p) {
    try {
      const res = await req(p, BASE + this.probePath, { timeoutMs: 14000, connectTimeoutMs: 8000, headers: { accept: 'application/json', 'user-agent': UA } });
      this.statusHist[res.status] = (this.statusHist[res.status] || 0) + 1;
      return res.status === 200 && /system_name/.test(res.text);
    } catch (e) {
      this.statusHist.err = (this.statusHist.err || 0) + 1;
      return false;
    }
  }
  /** { pin, tested, reuse } — `pin: null` when the scan budget ran out. */
  async acquire() {
    this.recent = this.recent.filter((r) => Date.now() - r.at < 240000 && !this.dead.has(r.p.line));
    for (const r of this.recent.slice(0, 4)) {
      if (await this.probe(r.p)) {
        this.remember(r.p);
        return { pin: r.p, tested: 0, reuse: true };
      }
      this.retire(r.p);
    }
    let testedThis = 0;
    while (testedThis < this.scanMax) {
      const batch = this.take(Math.min(this.parallel, this.scanMax - testedThis));
      if (!batch.length) break;
      testedThis += batch.length;
      this.scanned += batch.length;
      const results = await Promise.all(batch.map(async (p) => ({ p, ok: await this.probe(p) })));
      const win = results.find((r) => r.ok);
      for (const r of results) {
        if (!r.ok) this.retire(r.p);
        else if (r !== win) this.remember(r.p);
      }
      if (win) {
        this.remember(win.p);
        return { pin: win.p, tested: testedThis, reuse: false };
      }
    }
    return { pin: null, tested: testedThis, reuse: false };
  }
  get remaining() {
    return this.priority.length - this.pIdx + this.cold.length - this.cIdx;
  }
}

// --------------------------------------------------------------------------- mail

/** Proxy-pool bound Emailnator calls: a missing pool is an error, never direct. */
function mailExit(pool) {
  if (!pool) throw new Error('mail: refusing direct request (no proxy pool)');
  return pool.next();
}

async function mailList(plain, pool, { tries = MAIL_TRIES } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const p = mailExit(pool);
    try {
      // Recycled Emailnator boxes can carry dozens of stale messages (bounces,
      // other people's signups); a 20-message window can hide the new mail.
      const messages = await emailnator.listMessages(plain, p, { limit: 50 });
      pool.alive(p);
      return messages;
    } catch (e) {
      last = e;
      pool.kill(p);
    }
  }
  throw new Error(`mail list: ${String(last && last.message).slice(0, 140)}`);
}

async function mailRead(id, pool, { tries = MAIL_TRIES } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const p = mailExit(pool);
    try {
      const full = await emailnator.readMessage(id, p);
      pool.alive(p);
      return full;
    } catch (e) {
      last = e;
      pool.kill(p);
    }
  }
  throw new Error(`mail read: ${String(last && last.message).slice(0, 140)}`);
}

async function mailNew(pool, { tries = 4 } = {}) {
  if (!emailnator) throw new Error('emailnator module missing');
  let last = null;
  for (let i = 0; i < tries; i++) {
    const p = mailExit(pool);
    try {
      const box = await emailnator.newAddress(p);
      pool.alive(p);
      return { ...box, exit: p.line, provider: 'emailnator' };
    } catch (e) {
      last = e;
      pool.kill(p);
    }
  }
  throw new Error(`mail generate: ${String(last && last.message).slice(0, 160)}`);
}

const msgId = (m) => String(m.message_id || m.id || '');

/**
 * A mail must *look* like a verification mail before its digits are trusted:
 * after the first pinned attempt read "2026" out of a Polish village-election
 * newsletter ("Piękna Wieś Podkarpacka 2026") and submitted it as a code, the
 * extraction path got this gate. Bounces and marketing never carry one of these.
 */
const VERIFY_WORDS = /验证码|校验码|动态码|验证|code|verification|verify|confirm|确认|激活|activat|otp|認証|认证|код/i;
const looksLikeVerification = (subject, text) => VERIFY_WORDS.test(`${subject || ''} ${String(text || '').slice(0, 600)}`);

/** Short stable id for a cookie jar, for evidence tables (no secrets in logs). */
const cookieId = (cookie) => (cookie ? require('crypto').createHash('sha1').update(cookie).digest('hex').slice(0, 8) : 'none');

async function inboxSnapshot(plain, pool) {
  try {
    const messages = await mailList(plain, pool);
    return new Set(messages.map(msgId).filter(Boolean));
  } catch (e) {
    return null; // caller decides: a failed snapshot must never look like "empty box"
  }
}

/**
 * A snapshot that *succeeded* is a precondition for the freshness guarantee: if
 * it fails, every old message (bounces included) would look "fresh" and the
 * code we read could be a stranger's. Bounded retries, then give up loudly.
 */
async function snapshotOrThrow(plain, pool, { tries = 5, gapMs = 4000 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const s = await inboxSnapshot(plain, pool);
    if (s) return s;
    last = i;
    await sleep(gapMs);
  }
  throw new Error(`mail snapshot failed after ${tries} tries (exits unhealthy)`);
}

/**
 * Polls until a message *not* present in `since` carries a code. Returns the
 * first hit plus every fresh message it inspected (evidence), and the time to
 * that first hit relative to the poll loop's start (= sendCode time).
 */
async function waitFreshCode(plain, pool, { since, dotted = null, timeoutMs = CODE_WAIT_MS, pollMs = POLL_MS, panelDomain = null } = {}) {
  const t0 = Date.now();
  const dump = [];
  let lastErr = null;
  const forms = [...new Set([plain, dotted].filter(Boolean))];
  const senderRe = SENDER ? new RegExp(SENDER, 'i') : null;
  const owns = (m) =>
    Boolean(senderRe && senderRe.test(String(m.from || ''))) ||
    Boolean(panelDomain && new RegExp(String(panelDomain).replace(/\./g, '\\.'), 'i').test(String(m.from || '')));
  const readOne = async (m) => {
    const id = msgId(m);
    let full = {};
    // Emailnator's shared pool answers a stub without `content` (or
    // `{"status":"error","message":"Message not found"}`) for a fraction of the
    // ids its own list just handed out — re-reading the same id usually lands on
    // a shard that has the message (measured: 1st read stub, 2nd read full body).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        full = await mailRead(id, pool, { tries: 2 });
      } catch (e) {
        full = {};
      }
      if (full && (full.content || full.text || full.html)) break;
      await sleep(1200 + attempt * 1800);
    }
    // Emailnator's free read (`GET /api/message/<id>`) answers
    // `{id,from,subject,date,content,has_attachments,attachments}` — the body is
    // `content` (HTML). The old reader only looked at `text`/`html`, so every
    // body was invisible and only subject-line codes were ever found.
    const bodyHtml = String(full.content || full.html || '');
    const text = `${m.subject || ''}\n${full.text || ''}\n${bodyHtml.replace(/<[^>]+>/g, ' ')}`.replace(/\s+/g, ' ');
    const verificationMail = looksLikeVerification(m.subject, text);
    const code = verificationMail ? extractCode(text) : null;
    const stamp = (o) => {
      if (!o) return null;
      for (const k of ['created_at', 'createdAt', 'date', 'Date', 'received', 'received_at', 'timestamp', 'time', 'ts']) if (o[k]) return { key: k, value: String(o[k]) };
      return null;
    };
    const entry = {
      id,
      subject: m.subject,
      from: m.from,
      bounce: /mailer-daemon|delivery status notification|postmaster/i.test(`${m.from || ''} ${m.subject || ''}`),
      verificationMail,
      fromPanel: Boolean(owns(m)),
      code,
      atLocal: Date.now() - t0,
      listStamp: stamp(m),
      readStamp: stamp(full),
      listRaw: JSON.stringify(m).slice(0, 600),
      readKeys: Object.keys(full).slice(0, 20),
      text: text.slice(0, 4000),
    };
    dump.push(entry);
    return entry;
  };
  while (Date.now() - t0 < timeoutMs) {
    let messages = [];
    try {
      // Emailnator's message API has been observed keyed by the dotted form while
      // the mailbox was registered dot-free; read both and merge by id.
      const lists = await Promise.all(forms.map((f) => mailList(f, pool, { tries: 1 }).catch(() => [])));
      const byId = new Map();
      for (const m of lists.flat()) byId.set(msgId(m), m);
      messages = [...byId.values()];
    } catch (e) {
      lastErr = String(e.message).slice(0, 160);
      await sleep(pollMs * 2);
      continue;
    }
    const fresh = messages.filter((m) => msgId(m) && !since.has(msgId(m)));
    fresh.sort((a, b) => (Number(msgId(b)) || 0) - (Number(msgId(a)) || 0));
    const panelOwned = fresh.filter((m) => owns(m));
    const others = fresh.filter((m) => !owns(m));

    for (const m of panelOwned) {
      if (Date.now() - t0 > timeoutMs) break;
      const e = await readOne(m);
      if (e.code) return { code: e.code, id: e.id, subject: e.subject, text: e.text, dump, tRead: Date.now() - t0, timeout: false, fromPanel: true };
    }
    // A shared/recycled box carries other services' codes (measured: a ShopOS code
    // was submitted as AIAIAI's). Once the panel's *own* mail has been seen, a
    // foreign code is never a substitute — that would manufacture a wrong refusal.
    if (panelOwned.length) {
      return { code: null, panelMailSeen: true, dump, lastErr, tRead: null, timeout: false };
    }
    // With `--sender` the panel's sender is known: a foreign code cannot be the
    // panel's, so keep waiting for the panel's own mail instead of submitting
    // one (measured: Leo Studio read a foreign code at 112s while its own mail
    // arrived at ~215s — the foreign submit burned the cycle and the re-send
    // invalidated the real code).
    if (STRICT_SENDER) {
      await sleep(pollMs);
      continue;
    }
    for (const m of others) {
      if (Date.now() - t0 > timeoutMs) break;
      const e = await readOne(m);
      if (e.code) return { code: e.code, id: e.id, subject: e.subject, text: e.text, dump, tRead: Date.now() - t0, timeout: false, fromPanel: false };
    }
    await sleep(pollMs);
  }
  return { code: null, dump, lastErr, tRead: null, timeout: true };
}

async function dumpInbox(box, freshDump, extra = {}) {
  const file = path.join(DIR, 'out', `inbox-${box.plain.replace(/[^a-z0-9]+/gi, '_')}.json`);
  let all = [];
  try {
    all = box.provider === 'imap' ? [] : (await mailList(box.plain, box._pool)).map((m) => ({ id: msgId(m), subject: m.subject, from: m.from }));
  } catch (e) {
    /* keep the fresh dump */
  }
  writeJson(file, { at: nowIso(), email: box.plain, dotted: box.dotted, exit: box.exit, ...extra, freshMessages: freshDump, mailboxMessages: all });
  log(`  inbox dump → ${path.relative(process.cwd(), file)} (${freshDump.length} fresh / ${all.length} total)`);
  return file;
}

// --------------------------------------------------------------------------- exit lists

const ROOT = path.resolve(__dirname);
const HOT_FILES = [
  path.join(__dirname, 'out', 'pool', 'mintx2-live.txt'),
  path.join(__dirname, 'out', 'community-live-aiaiai.txt'),
  path.join(__dirname, 'out', 'pool-exits.txt'),
];
const MAIL_FILES = [
  path.join(__dirname, 'out', 'pool', 'mintx2-mail-live.txt'),
  path.join(__dirname, 'out', 'community-live-emailnator.txt'),
];

function loadSoft(files) {
  try {
    return loadExits(files, { shuffle: false });
  } catch (e) {
    return [];
  }
}

/**
 * The local proxy pool answers "which exits are proven for this host right now"
 * over its loopback control plane. Loopback only — the exits it returns are the
 * ones that leave this machine. `klass` narrows to an egress class, which is the
 * one variable in the exit-class control (res vs isp vs dc).
 */
function fetchPool({ target, klass = '', limit = 30, prove = false, timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const qs = `target=${encodeURIComponent(target)}&limit=${limit}${klass ? `&class=${encodeURIComponent(klass)}` : ''}${prove ? '&prove=1' : ''}`;
    const r = require('http').get(`http://127.0.0.1:8791/pool?${qs}`, { timeout: timeoutMs }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(text);
          resolve({ ...j, lines: (j.exits || []).map((e) => ({ line: `${e.protocol}://${e.line}`, klass: e.class, proven: Boolean(e.provenFor) })) });
        } catch (e) {
          resolve({ error: 'pool json parse', text: text.slice(0, 200) });
        }
      });
    });
    r.on('error', (e) => resolve({ error: String(e.message).slice(0, 120) }));
    r.setTimeout(timeoutMs, () => r.destroy(new Error('pool timeout')));
  });
}

/** Parse pool-export lines with their `# class=… proven=…` annotations. */
function loadAnnotated(file) {
  const out = [];
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.split('#')[0].trim();
      if (!line || line.startsWith('#')) continue;
      const notes = raw.slice(line.length);
      const klass = (notes.match(/class=(\w+)/) || [])[1] || null;
      const proven = /proven=true/.test(notes);
      out.push({ line: /^[a-z]+:\/\//i.test(line) ? line : `http://${line}`, klass, proven });
    }
  } catch (e) {}
  return out;
}

// --------------------------------------------------------------------------- register probes

/** Which field name does this fork read, and what does it answer for a bad code? */
async function probeRegister(panel, email) {
  const out = [];
  const call = async (name, body) => {
    try {
      const r = await panel.call('/api/user/register', { method: 'POST', body, tries: 1, timeoutMs: 30000 });
      out.push({ name, request: body, status: r.status, response: String(r.text || '').slice(0, 400), exit: r.exit });
    } catch (e) {
      out.push({ name, request: body, error: String(e.message).slice(0, 160) });
    }
    log(`  probe ${name} → ${out[out.length - 1].status || 'ERR'} ${String(out[out.length - 1].response || out[out.length - 1].error).slice(0, 160)}`);
  };
  const user = `${TAG}${randHex(5)}`.slice(0, 18);
  const pass = randPass();
  await call('empty-body', {});
  await call('verification_code-field', { username: user, password: pass, password2: pass, email, verification_code: '000000', aff_code: '' });
  await call('code-field', { username: `${user}b`, password: pass, password2: pass, email, code: '000000', aff_code: '' });
  await call('no-code-field', { username: `${user}c`, password: pass, password2: pass, email, aff_code: '' });
  return out;
}

// --------------------------------------------------------------------------- main

(async () => {
  const priority = loadSoft(POOLS.length ? POOLS.filter((f) => !/emailnator|mail/.test(f)) : HOT_FILES);
  for (const a of loadAnnotated(path.join(__dirname, 'out', 'pool-exits.txt'))) {
    try {
      const p = require('./proxy.js').parseProxy(a.line);
      if (p) {
        p.klass = a.klass;
        p.line = a.line;
        priority.unshift(a.proven ? p : p); // annotated pool lines go first either way
      }
    } catch (e) {}
  }
  const pool = await fetchPool({ target: new URL(BASE).host, klass: EXIT_CLASS, limit: 30, prove: Boolean(EXIT_CLASS) });
  const poolLines = [];
  for (const f of pool.lines || []) {
    try {
      const p = require('./proxy.js').parseProxy(f.line);
      if (p) {
        p.klass = f.klass;
        p.proven = f.proven;
        p.line = f.line;
        poolLines.push(p);
      }
    } catch (e) {}
  }
  priority.unshift(...poolLines);
  const cold = loadExits(undefined, { shuffle: true });
  const hunter = new PinHunter(priority, cold);
  const poolMail = await fetchPool({ target: 'www.emailnator.com', limit: 20 });
  const mailExits = [];
  for (const f of [...(poolMail.lines || []), ...loadExits(MAIL_POOLS.length ? MAIL_POOLS : MAIL_FILES, { shuffle: true }).map((p) => ({ line: p.line, klass: p.klass }))]) {
    try {
      const p = require('./proxy.js').parseProxy(f.line);
      if (p) {
        p.line = f.line;
        p.klass = f.klass;
        mailExits.push(p);
      }
    } catch (e) {}
  }
  const mailPool = new ExitPool(mailExits, { label: `${NAME}-mail` });

  // IMAP path: the box is a real mailbox (readable bodies). The connection still
  // rides an exit — mailbox traffic is not provider traffic, but the same rule
  // is "never our own address", so it exits too.
  let imapBox = null;
  if (MAIL_MODE === 'imap') {
    if (!IMAP_USER || !IMAP_PASS) throw new Error('--mail imap needs IMAP_USER/IMAP_PASS (or --imap-user/--imap-pass)');
    const { MailboxImap } = require('./mailbox-imap.js');
    imapBox = new MailboxImap({
      user: IMAP_USER,
      password: IMAP_PASS,
      host: one('imap-host', process.env.IMAP_HOST || undefined),
      domain: one('mail-domain', process.env.MAIL_DOMAIN || undefined),
      proxy: mailPool.next(),
      log: (m) => log('  ' + m),
    });
  }

  log(
    `# ${NAME} pinned mint · base=${BASE} · priority=${priority.length} (pool=${poolLines.length}${EXIT_CLASS ? ` class=${EXIT_CLASS}` : ''}, poolNote=${String(pool.note || pool.error || '').slice(0, 80)}) cold=${cold.length} mail=${mailPool.exits.length} · count=${COUNT}${PROBE ? ' · PROBE' : ''}${STRICT_SENDER ? ` · sender=${SENDER} (strict)` : ''}${DELAY_FROM < 99 ? ` · delay-control from cycle ${DELAY_FROM} (+${DELAY_MS}ms)` : ''}`
  );

  let st = null;
  for (let i = 0; i < 6 && !st; i++) {
    const { pin } = await hunter.acquire();
    if (!pin) {
      log(`  gates: no exit reaches ${BASE} (scanned ${hunter.scanned}, statuses ${JSON.stringify(hunter.statusHist)})`);
      await sleep(20000);
      continue;
    }
    const panel = pinnedPanel(pin);
    try {
      const r = await panel.status();
      st = { pin: pin.line, r };
    } catch (e) {
      log(`  gates probe: ${pin.line} died (${String(e.message).slice(0, 80)}) — re-pinning`);
      hunter.retire(pin);
    }
  }
  if (!st) throw new Error(`no exit answers ${BASE}/api/status (scanned ${hunter.scanned})`);
  const g = gates(st.r.json);
  log(`gates: ${JSON.stringify({ site: g.system_name, reg: g.register_enabled, pwd: g.password_register, em: g.email_verification, ts: g.turnstile_check, ci: g.checkin_enabled, invite: g.invite_required })} · probed via ${st.pin}`);
  writeJson(path.join(DIR, 'out', `pinned-status-${Date.now()}.json`), st.r.json || { text: st.r.text });
  if (g.turnstile_check === true) {
    log('turnstile_check=true → this panel needs the browser mint; aborting');
    process.exit(2);
  }

  const made = [];
  const total = Math.min(COUNT, PROBE ? 1 : COUNT);

  // ---- mailbox transport probe: which read shape actually returns a body?
  // (Emailnator's `message-list` ids answer "Message not found" on /api/message/<id>,
  // and the code lives in the body, so this decides the whole gmail mail path.)
  if (PROBE_MAIL) {
    if (!emailnator) throw new Error('emailnator module missing');
    const box = REUSE_BOX ? { plain: REUSE_BOX, dotted: null, exit: 'reused-box' } : await mailNew(mailPool);
    log(`mail probe box ${box.plain}${box.dotted ? ` (dotted ${box.dotted})` : ''} via ${box.exit}`);
    const mailReq = async (pathname, { method = 'GET', body = null } = {}) => {
      for (let i = 0; i < 4; i++) {
        const p = mailExit(mailPool);
        try {
          const res = await req(p, `https://www.emailnator.com${pathname}`, {
            method,
            body,
            timeoutMs: 25000,
            connectTimeoutMs: 8000,
            headers: { accept: '*/*', origin: 'https://www.emailnator.com', referer: 'https://www.emailnator.com/', 'user-agent': UA, ...(body ? { 'content-type': 'application/json' } : {}) },
          });
          mailPool.alive(p);
          return { status: res.status, text: res.text, exit: p.line };
        } catch (e) {
          mailPool.kill(p);
        }
      }
      return { status: 0, text: '', error: 'all exits failed' };
    };
    const list = await mailReq('/api/message-list', { method: 'POST', body: { email: box.plain, limit: 10 } });
    log(`list ${list.status} ${String(list.text).slice(0, 160)}`);
    let msgs = [];
    try {
      msgs = JSON.parse(list.text).messages || [];
    } catch (e) {}
    if (!msgs.length) {
      log('mail probe: box empty — nothing to read (run again in a minute)');
      return;
    }
    const m = msgs.find((x) => !/mailer-daemon|delivery status/i.test(`${x.from} ${x.subject}`)) || msgs[0];
    const id = String(m.id || m.message_id);
    log(`target ${id.slice(0, 22)} | ${String(m.from).slice(0, 34)} | ${String(m.subject).slice(0, 50)} | keys=${Object.keys(m).join(',')}`);
    const shapes = [
      ['GET', `/api/message/${encodeURIComponent(id)}`, null],
      ['GET', `/api/message/${encodeURIComponent(id)}?email=${encodeURIComponent(box.plain)}`, null],
      ['POST', '/api/message', { id, email: box.plain }],
      ['POST', '/api/message-content', { id, email: box.plain }],
      ['POST', '/api/get-message', { id, email: box.plain }],
      ['GET', `/api/messages/${encodeURIComponent(id)}`, null],
      ['GET', `/api/message/${encodeURIComponent(id)}/${encodeURIComponent(box.plain)}`, null],
    ];
    const results = [];
    for (const [method, pathname, body] of shapes) {
      const r = await mailReq(pathname, { method, body });
      results.push({ method, pathname, status: r.status, text: String(r.text || '').slice(0, 300), exit: r.exit, error: r.error });
      log(`  ${method} ${pathname} → ${r.status} ${String(r.text || r.error || '').slice(0, 200)}`);
    }
    writeJson(path.join(DIR, 'out', `mail-probe-${Date.now()}.json`), { at: nowIso(), box: box.plain, message: { id, from: m.from, subject: m.subject, keys: Object.keys(m) }, results });
    return;
  }

  for (let i = 0; i < total; i++) {
    const index = accounts.length + i + 1;
    const username = `${TAG}${randHex(6)}`.slice(0, 18);
    const password = randPass();
    const rec = { provider: NAME, base: BASE, index, username, password, created: nowIso(), steps: {}, cycles: [] };
    let box = null;
    let done = false;
    log(`#${index} start · user=${username}`);

    for (let cycle = 1; cycle <= MAX_CYCLE && !done; cycle++) {
      if (!withinBudget()) {
        log(`  budget exhausted (${Math.round((Date.now() - startedAt) / 1000)}s) — stopping`);
        rec.status = 'budget';
        break;
      }
      const cyc = { cycle, at: nowIso() };
      rec.cycles.push(cyc);
      let panel = null;
      try {
        const { pin, tested, reuse } = await hunter.acquire();
        cyc.scan = tested;
        cyc.reuse = Boolean(reuse);
        if (!pin) {
          cyc.status = 'no-exit';
          rec.status = 'no-exit';
          log(`  ✖ no exit reaches ${BASE} (scanned ${tested}, remaining ${hunter.remaining}, statuses ${JSON.stringify(hunter.statusHist)})`);
          break;
        }
        cyc.exit = pin.line;
        cyc.exitClass = pin.klass || 'unknown';
        log(`  pin ${pin.line}${pin.klass ? ` [class=${pin.klass}]` : ''}${reuse ? ' (reused)' : ` (scanned ${tested})`}`);
        panel = pinnedPanel(pin);

        if (!box) {
          if (MAIL_MODE === 'imap') {
            const acc = await imapBox.createAccount({ address: MAIL_ADDRESS || undefined });
            box = { plain: acc.address, dotted: null, exit: 'imap', provider: 'imap', _pool: mailPool, since: new Set() };
          } else if (REUSE_BOX) {
            box = { plain: REUSE_BOX, dotted: null, exit: 'reused-box', provider: 'emailnator', _pool: mailPool, since: null };
          } else {
            const b = await mailNew(mailPool);
            box = { ...b, _pool: mailPool, since: null };
          }
          rec.email = box.plain;
          rec.mailbox = { plain: box.plain, dotted: box.dotted, exit: box.exit, provider: box.provider };
          log(`  box ${box.plain}${box.dotted ? ` (dotted ${box.dotted})` : ''} via ${box.exit}`);
        }

        if (PROBE_REGISTER) {
          cyc.registerProbes = await probeRegister(panel, box.plain);
          writeJson(path.join(DIR, 'out', `pinned-register-probes-${index}.json`), cyc.registerProbes);
        }

        // snapshot BEFORE sendCode: Emailnator recycles addresses, and a code
        // that was in the box before this attempt belongs to someone else.
        // A *failed* snapshot is not "empty box" — it aborts the cycle.
        // IMAP aliases are fresh per account, so there is nothing to snapshot.
        box.since = MAIL_MODE === 'imap' ? new Set() : await snapshotOrThrow(box.plain, mailPool);
        cyc.snapshot = box.since.size;

        const t0 = Date.now();
        const sent = await panel.call(`/api/verification?email=${encodeURIComponent(box.plain)}`, { tries: 1, timeoutMs: 30000 });
        const bodyText = String(sent.text || '');
        const serverStamp = (() => {
          const m = bodyText.match(/"(created_at|expires_at|sent_at|timestamp|time)"\s*:\s*"?([^",}]+)"?/);
          return m ? { key: m[1], value: m[2] } : null;
        })();
        cyc.sendCode = {
          status: sent.status,
          body: bodyText.slice(0, 300),
          serverHeaders: { date: sent.headers && sent.headers['date'], server: sent.headers && sent.headers['server'], cfRay: sent.headers && sent.headers['cf-ray'] },
          serverStamp,
          exit: sent.exit,
          cookie: panel.cookie || '',
          cookieId: cookieId(panel.cookie),
          t: Date.now() - t0,
        };
        log(`  sendCode ${sent.status} ${cyc.sendCode.body.slice(0, 140)} · cookie=${panel.cookie ? 'set' : 'none'} · date=${cyc.sendCode.serverHeaders.date || 'n/a'}${serverStamp ? ` · ${serverStamp.key}=${serverStamp.value}` : ' · no server-side code stamp'}`);
        if (!(sent.json && sent.json.success)) {
          // A recycled Emailnator box can already be *registered* on the panel
          // (measured 2026-10-15, fast.qianxing.pro: `Email address is already in
          // use` for a probe box whose domain the same panel accepts). That is a
          // box collision, not a wall — drop the box and take a fresh one next
          // cycle instead of aborting the account.
          if (MAIL_MODE !== 'imap' && /already (in use|registered)|已被?使用|已被?注册|already exists/i.test(bodyText)) {
            cyc.status = 'box-taken';
            rec.status = 'box-taken';
            log('  sendCode refused: box already registered on the panel — discarding it, fresh box next cycle');
            box = null;
            continue;
          }
          cyc.status = 'send-refused';
          rec.status = 'send-refused';
          break;
        }

        let got;
        if (MAIL_MODE === 'imap') {
          const tI = Date.now();
          try {
            const code = await imapBox.waitForCode({ address: box.plain, timeoutMs: CODE_WAIT_MS, pollMs: Math.max(POLL_MS, 4000) });
            got = { code, tRead: Date.now() - tI, dump: [{ id: 'imap', code, text: '(read over IMAP — real message body)' }], timeout: false, fromPanel: null };
          } catch (e) {
            got = { code: null, tRead: null, dump: [{ id: 'imap', note: String(e.message).slice(0, 160) }], lastErr: String(e.message).slice(0, 160), timeout: true };
          }
        } else {
          got = await waitFreshCode(box.plain, mailPool, { since: box.since, dotted: box.dotted, timeoutMs: CODE_WAIT_MS, pollMs: POLL_MS, panelDomain: PANEL_DOMAIN });
        }
        cyc.mail = { tRead: got.tRead, code: got.code, id: got.id || null, subject: got.subject || null, inspected: got.dump.length, lastErr: got.lastErr || null, fromPanel: got.fromPanel ?? null, panelMailSeen: Boolean(got.panelMailSeen) };
        if (!got.code) {
          const panelSeen = Boolean(got.panelMailSeen);
          log(
            panelSeen
              ? `  ✖ panel mail arrived (${got.dump.filter((d) => d.fromPanel).length} from ${PANEL_DOMAIN}) but no code was readable — reader wall, foreign codes refused`
              : `  ✖ no fresh code in ${CODE_WAIT_MS}ms${got.lastErr ? ` (${got.lastErr})` : ''} · inspected ${got.dump.length} (bounces ${got.dump.filter((d) => d.bounce).length})`
          );
          cyc.inboxDump = await dumpInbox(box, got.dump, { note: panelSeen ? 'panel mail seen, body unreadable' : 'no fresh code', sinceCount: box.since ? box.since.size : null });
          rec.status = panelSeen ? 'mail-unreadable' : 'no-code';
          if (PROBE || panelSeen) break;
          box.since = (await inboxSnapshot(box.plain, mailPool)) || box.since;
          continue;
        }
        log(`  code ${got.code} · t_read=${got.tRead}ms · «${String(got.subject).slice(0, 80)}»`);
        cyc.inboxDump = await dumpInbox(box, got.dump, { note: 'code read', chosen: got.code });

        if (PROBE) {
          cyc.status = 'probe-done';
          rec.status = 'probe-done';
          log('  probe mode: stopping before register');
          break;
        }

        const regBody = { username, password, password2: password, email: box.plain, verification_code: got.code, aff_code: AFF, turnstile: '' };
        const delay = cycle >= DELAY_FROM ? DELAY_MS : 0;
        if (delay) {
          log(`  delay control: waiting ${delay}ms before register (cycle ${cycle})`);
          await sleep(delay);
        }
        const tRegStart = Date.now();
        const reg = await panel.call('/api/user/register', { method: 'POST', body: regBody, tries: 1, timeoutMs: 40000 });
        cyc.register = {
          t_submit: tRegStart - t0,
          delayMs: delay,
          status: reg.status,
          request: regBody,
          body: String(reg.text || '').slice(0, 500),
          exit: reg.exit,
          cookie: panel.cookie || '',
          cookieId: cookieId(panel.cookie),
          cookieChanged: (panel.cookie || '') !== (cyc.sendCode.cookie || ''),
        };
        log(`  register ${reg.status} · t_submit=${cyc.register.t_submit}ms${delay ? ` (+${delay}ms deliberate)` : ''} · cookie=${cyc.register.cookieId}${cyc.register.cookieChanged ? ' CHANGED' : ' same'} · ${cyc.register.body.slice(0, 160)}`);

        if (reg.json && reg.json.success) {
          cyc.status = 'registered';
          rec.status = 'registered';
          // ---- mint phase (cookie session; a dead pin is replaced, the cookie rides along)
          const rePin = async (why) => {
            const got2 = await hunter.acquire();
            if (!got2.pin) throw new Error(`no exit for ${why}`);
            panel.supply.pin = got2.pin;
            panel.supply.dead = false;
            panel.agent = createAgent(got2.pin, { keepAlive: true, maxSockets: 1 });
            log(`  re-pin for ${why}: ${got2.pin.line}`);
            return got2.pin;
          };
          const guard = async (fn, label) => {
            try {
              return await fn();
            } catch (e) {
              if (isExitError(e)) {
                await rePin(label);
                return fn();
              }
              throw e;
            }
          };

          const login = await guard(() => panel.login({ username: rec.username, password, tries: 1 }), 'login');
          const lj = login.json || {};
          rec.steps.login = { status: login.status, success: lj.success, message: lj.message, hasCookie: !!panel.cookie, exit: login.exit };
          log(`  login ${login.status} success=${lj.success}`);

          const self = await guard(() => panel.self(1), 'self');
          rec.steps.self = { status: self.status, id: self.json && self.json.data && self.json.data.id, quota: self.json && self.json.data && (self.json.data.quota ?? self.json.data.balance) };
          if (self.json && self.json.data && self.json.data.id) panel.userId = self.json.data.id;
          log(`  self id=${rec.steps.self.id} quota=${rec.steps.self.quota}`);

          if (CHECKIN) {
            const ci = await guard(() => panel.checkin(1), 'checkin');
            rec.steps.checkin = { status: ci.status, body: ci.json ? { success: ci.json.success, message: ci.json.message } : String(ci.text || '').slice(0, 150) };
            log(`  checkin ${ci.status} ${JSON.stringify(rec.steps.checkin.body).slice(0, 140)}`);
          }

          const created = await guard(() => panel.createToken(`${TAG}-${index}`, 2), 'token');
          let key = created.key;
          rec.steps.createToken = { status: created.status, body: created.json ? { success: created.json.success, message: created.json.message } : String(created.text || '').slice(0, 150), keySource: key ? 'response' : null };
          // Some forks answer the create with a MASKED key (`tbCR******…`,
          // measured on Leo Studio 2026-10-15) — that string 401s at /v1/models.
          // A masked key is as good as no key: go through the list/reveal path.
          if (!key || /\*/.test(key)) {
            const list = await guard(() => panel.listTokens(2), 'token-list');
            const items = list.items || [];
            const pick = items.find((t) => t.name === `${TAG}-${index}`) || items[0];
            if (pick && pick.key) key = pick.key;
            if ((!key || /\*/.test(key)) && pick && pick.id) {
              const reveal = await guard(() => panel.tokenKey(pick.id, 2), 'token-key');
              key = reveal.key;
            }
          }
          log(`  token ${created.status} key=${key ? key.slice(0, 10) + '…' : 'NONE'}`);
          if (!key) {
            rec.status = 'no-key';
            break;
          }
          rec.key = key;

          // Verification must not ride the exit that minted the key: a same-egress
          // pass can be session state rather than key validity (same rule, after
          // the completions.me batch). Take a *different* proven exit when one is
          // available and record both sides plus the independence flag.
          const mintExit = (panel.supply.pin && panel.supply.pin.line) || panel.supply.pin.host;
          let verifier = panel;
          let verifyExit = mintExit;
          let independent = false;
          try {
            const alt = await hunter.acquire();
            if (alt.pin && (alt.pin.line || `${alt.pin.host}:${alt.pin.port}`) !== mintExit) {
              verifier = pinnedPanel(alt.pin);
              verifyExit = alt.pin.line || `${alt.pin.host}:${alt.pin.port}`;
              independent = true;
              log(`  verify exit ${verifyExit} (mint exit ${mintExit}, independent=${independent})`);
            }
          } catch (e) {
            log(`  verify exit unavailable (${String(e.message).slice(0, 80)}) — verifying on the mint exit`);
          }

          const models = await verifier.models(key, { tries: 2 });
          rec.verify = {
            host: new URL(BASE).host,
            endpoint: '/v1/models',
            status: models.status,
            model: null,
            mintExit,
            exit: verifyExit,
            independent,
            sameEgress: !independent,
          };
          const list = models.status === 200 && models.json && Array.isArray(models.json.data) ? models.json.data : null;
          if (list) writeJson(path.join(DIR, 'models.json'), { at: nowIso(), base: BASE, models: list.map((m) => m.id || m) });
          const ids = list ? list.map((m) => m.id) : [];
          const chatModel = OFFER_MODEL || pickCheapest(ids) || '';
          if (chatModel) {
            const chat = await verifier.chat(key, chatModel, { tries: 2, timeoutMs: 90000 });
            rec.verify.model = chatModel;
            rec.verify.chat_status = chat.status;
            rec.verify.chat_text = chat.json ? JSON.stringify(chat.json).slice(0, 300) : String(chat.text || '').slice(0, 200);
            log(`  chat ${chatModel} → ${chat.status} ${String(rec.verify.chat_text).slice(0, 120)}`);
          } else {
            rec.verify.note = 'no model ids listed — completion check skipped';
          }
          const ok = models.status === 200 && (chatModel ? rec.verify.chat_status === 200 || /balance|quota|余额|分组|group/i.test(rec.verify.chat_text || '') : true);
          rec.verify.ok = ok;
          if (ok && !independent) rec.verify.sameEgressFlagged = 'verified on the mint exit — independence not established';
          if (ok) {
            rec.status = 'minted';
            if (!fs.existsSync(KEYS) || !fs.readFileSync(KEYS, 'utf8').includes(key)) appendLine(KEYS, key);
            made.push(key);
            log(`  ✔ MINTED (models=${models.status}, chat=${rec.verify.chat_status || 'n/a'}, quota=${rec.steps.self.quota})`);
          } else {
            rec.status = 'key-unverified';
            log(`  ✖ key failed verification (models=${models.status}${chatModel ? `, chat=${rec.verify.chat_status}` : ''})`);
          }
          done = true;
          break;
        }

        const msg = String((reg.json && reg.json.message) || reg.text || '');
        if (/username|用户名/i.test(msg) && !/code|验证码/i.test(msg)) {
          const alt = `u${randHex(8)}`;
          log(`  register rejected username (${msg}) → retry as ${alt}`);
          cyc.usernameRetry = alt;
          rec.username = alt;
          const reg2 = await panel.call('/api/user/register', { method: 'POST', body: { ...regBody, username: alt }, tries: 1, timeoutMs: 40000 });
          cyc.register2 = { status: reg2.status, body: String(reg2.text || '').slice(0, 400) };
          if (reg2.json && reg2.json.success) {
            cyc.status = 'registered';
            rec.status = 'registered';
            log('  register (alt username) OK — but flow continues next cycle only for evidence');
          }
        }
        if (/incorrect|expired|验证码/i.test(msg)) {
          cyc.status = 'code-refused';
          // Discriminator: re-submitting the *same* code on the *same* pin. If the
          // answer changes ("already used"/different wording) the first attempt
          // did consume it; if it is byte-identical, that code was never valid
          // (stale mail / expired on arrival), which is a different wall.
          try {
            const again = await panel.call('/api/user/register', { method: 'POST', body: regBody, tries: 1, timeoutMs: 30000 });
            cyc.registerSameCodeRetry = { status: again.status, body: String(again.text || '').slice(0, 300), t_submit: Date.now() - t0 };
            log(`  same-code re-submit → ${again.status} ${cyc.registerSameCodeRetry.body.slice(0, 140)}`);
          } catch (e) {
            cyc.registerSameCodeRetry = { error: String(e.message).slice(0, 160) };
          }
          log('  code refused → next cycle re-sends on a fresh pin with a fresh snapshot');
          box.since = (await inboxSnapshot(box.plain, mailPool)) || box.since;
          continue;
        }
        cyc.status = 'register-refused';
        rec.status = 'register-refused';
        break;
      } catch (e) {
        const exitErr = isExitError(e);
        cyc.status = exitErr ? 'pin-died' : 'error';
        cyc.error = String(e.message).slice(0, 220);
        log(`  ✖ ${cyc.status}: ${cyc.error}`);
        // A pin that answered the probe can still die mid-cycle (measured: yjs
        // burned three cycles on one flaky exit because every re-probe passed).
        // Retire it so the next acquire scans on.
        if (exitErr && panel && panel.supply && panel.supply.pin) hunter.retire(panel.supply.pin);
        if (box) {
          box.since = (await inboxSnapshot(box.plain, mailPool)) || box.since;
        }
        rec.status = cyc.status;
        if (!exitErr && /no exit/i.test(cyc.error)) break;
      }
    }

    accounts.push(rec);
    writeJson(ACCOUNTS, accounts);
    if (PROBE) break;
  }

  const minted = accounts.filter((a) => a.provider === NAME && a.status === 'minted').length;
  log(`done: ${NAME} — ${made.length} new key(s) this run, ${minted} minted account(s) total · pins scanned=${hunter.scanned} statuses=${JSON.stringify(hunter.statusHist)}`);
})().catch((e) => {
  log(`FATAL ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
  process.exit(1);
});

/** Crude but predictable: prefer the smallest/cheapest-looking model id. */
function pickCheapest(ids) {
  if (!ids || !ids.length) return null;
  const rank = (id) => {
    let s = 5;
    if (/flash|nano|mini|small|lite|turbo|haiku|8b|7b|4b|1b/i.test(id)) s -= 3;
    if (/free/i.test(id)) s -= 2;
    if (/pro|opus|ultra|max|72b|70b|235b|405b|550b/i.test(id)) s += 3;
    if (/embed|rerank|whisper|tts|image|audio|video|vision/i.test(id)) s += 4;
    return s;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b))[0];
}
