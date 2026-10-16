'use strict';

/**
 * Shared plumbing for the bulk-mint tools.
 *
 * Hard rule baked in: **every request that leaves this machine goes through a
 * proxy**. `req()` throws when handed a null proxy instead of silently dialing
 * direct, so a missing exit surfaces as an error, never as our own IP reaching
 * a provider.
 *
 * Shared pieces: `proxy.js` (tunnels + agent), a local inbox broker
 * (Mailtrap / inboxes.com on 127.0.0.1:9700|9701).
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const { parseProxy, createAgent, loadPoolFile } = require(path.join(__dirname, 'proxy'));

const ROOT = path.resolve(__dirname);
const CODE_RE = /[0-9]{4,8}/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const randHex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const randPass = () => `Cw${randHex(8)}!${crypto.randomInt(100, 999)}`;

function jitter(base, spread = 0.35) {
  return Math.round(base * (1 + (Math.random() * 2 - 1) * spread));
}

// --------------------------------------------------------------------------- proxies

/** Files we screen into; every list is `scheme://host:port[  # comment]`. */
const DEFAULT_POOLS = [
  path.join(__dirname, 'out', 'community-live.txt'),
  path.join(__dirname, 'out', 'captcha-exits-live.txt'),
  path.join(__dirname, 'out', 'union-live.txt'),
  path.join(__dirname, 'out', 'freshpool-live.txt'),
  path.join(__dirname, 'out', 'pool-refresh-2026-10-14T18-56-54.txt'),
];

function loadExits(files = DEFAULT_POOLS, { shuffle = true } = {}) {
  const seen = new Set();
  const out = [];
  // Pool files are appended to by several writers; one of them has been seen
  // dumping JSON fragments into `union-live.txt` (`"ageMs": 1747591,`,
  // `"candidates": 10,` — 4145 of 5961 lines measured on 2026-10-15). Those
  // parse into proxies whose host is `"ageMs"` etc., and every mint then burns
  // exit tries on `getaddrinfo ENOTFOUND "ageMs"`. Hosts must look like an
  // IPv4/hostname and ports must be numeric.
  const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9.\-]*[a-z0-9])?)$/i;
  for (const f of files) {
    let lines;
    try {
      lines = loadPoolFile(f);
    } catch (e) {
      continue;
    }
    // Files the screen wrote after probing a real target are worth more than a
    // raw candidate dump: they get extra weight so mints actually use them.
    const warm = /community-live|community-screen|router-|captcha-exits|freshpool|union-live/.test(path.basename(String(f)));
    const weight = warm ? 3 : 1;
    for (const line of lines) {
      const p = typeof line === 'string' ? parseProxy(line) : line;
      if (!p) continue;
      const port = Number(p.port);
      if (!HOST_RE.test(String(p.host || '')) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
      const id = `${p.host}:${p.port}`;
      if (seen.has(id)) continue;
      seen.add(id);
      p.connectTimeoutMs = 8000;
      p.timeoutMs = 32000;
      p.line = `${p.protocol}://${p.host}:${p.port}`;
      for (let i = 0; i < weight; i++) out.push(p);
    }
  }
  if (shuffle) out.sort(() => Math.random() - 0.5);
  return out;
}

/**
 * Fail-closed HTTP: no proxy → throw (never fall back to our own address).
 *
 * `agent` (optional) is a caller-owned agent — the pinned flows pass a
 * keep-alive agent so every request of one account reuses a *single* tunnel
 * (one upstream exit), which is what an exit-bound verification code needs.
 */
function req(proxy, url, { method = 'GET', headers = {}, body = null, timeoutMs = 30000, connectTimeoutMs = 8000, agent = null } = {}) {
  if (!proxy) return Promise.reject(new Error('refusing direct request (no exit): ' + url));
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const payload =
      body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    if (payload && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    if (payload && !Object.keys(h).some((k) => k.toLowerCase() === 'content-length')) h['Content-Length'] = payload.length;
    proxy.connectTimeoutMs = connectTimeoutMs;
    proxy.timeoutMs = timeoutMs;
    const r = lib.request(
      {
        method,
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        agent: agent || createAgent(proxy),
        headers: h,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      }
    );
    r.setTimeout(timeoutMs, () => r.destroy(new Error('timeout ' + url)));
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** JSON request: returns `{status, json, text, headers}`; parse failures keep text. */
async function jreq(proxy, url, opts) {
  const res = await req(proxy, url, opts);
  let json = null;
  try {
    json = JSON.parse(res.text);
  } catch (e) {
    /* keep text */
  }
  return { ...res, json };
}

const NETWORK_ERROR =
  /CONNECT|ECONN|EPIPE|socket|SOCKS|TLS|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|premature|destroyed|proxy|handshake|auth methods|refusing direct|certificate|self.signed|UNABLE_TO_VERIFY|doesn't match/i;

/** True when the failure is about the exit, not the provider's answer. */
function isExitError(err) {
  return NETWORK_ERROR.test(String((err && err.message) || err));
}

/**
 * Rotating proxy pool. `attempt(fn)` hands `fn` a fresh exit, retries on exit
 * errors, and retires exits that failed twice. Cookie/header state is the
 * caller’s job — same as the other mints, where each step re-picks an
 * exit because free exits live 1–3 minutes.
 */
class ExitPool {
  constructor(exits, { label: tag = '' } = {}) {
    this.exits = exits;
    this.index = 0;
    this.dead = new Map();
    this.tag = tag;
    this.sticky = null;
    this.hits = 0;
  }
  next() {
    if (!this.exits.length) throw new Error('proxy pool empty');
    // A proven exit is worth far more than a random candidate: free exits that
    // answer once usually keep answering for a few minutes, and every account is
    // ~10 sequential calls. Reuse it until it fails.
    if (this.sticky && (this.dead.get(this.sticky.line) || 0) < 2 && Math.random() < 0.8) return this.sticky;
    for (let i = 0; i < this.exits.length; i++) {
      const p = this.exits[this.index++ % this.exits.length];
      this.index %= this.exits.length;
      const d = this.dead.get(p.line) || 0;
      if (d < 2) return p;
    }
    // everything retired: reset so long runs keep moving
    this.dead.clear();
    return this.exits[this.index++ % this.exits.length];
  }
  kill(p) {
    if (!p) return;
    if (this.sticky === p) this.sticky = null;
    this.dead.set(p.line, (this.dead.get(p.line) || 0) + 1);
  }
  alive(p) {
    if (p) {
      this.sticky = p;
      this.hits++;
    }
  }
  async attempt(fn, { tries = 6, onFail = null, label = '' } = {}) {
    let last = null;
    for (let i = 0; i < tries; i++) {
      // `next()` may be async (LiveSupply preflights the target host per call)
      const p = await this.next();
      try {
        const out = await fn(p, i);
        this.alive(p);
        return out;
      } catch (e) {
        last = e;
        if (isExitError(e)) {
          this.kill(p);
          if (onFail) onFail(e, p, i);
          continue;
        }
        throw e;
      }
    }
    throw new Error(`${this.tag}${label ? label + ': ' : ''}exits exhausted after ${tries} tries: ${String(last && last.message).slice(0, 120)}`);
  }
}

/** Which address does this exit present? (also proves it is not transparent) */
async function exitIp(proxy, { timeoutMs = 15000 } = {}) {
  const res = await req(proxy, 'https://api.ipify.org/?format=json', { timeoutMs, headers: { accept: 'application/json' } });
  try {
    return String(JSON.parse(res.text).ip);
  } catch (e) {
    return res.text.trim().slice(0, 45);
  }
}

// --------------------------------------------------------------------------- mail

const BROKERS = { mailtrap: 'http://127.0.0.1:9700', inboxes: 'http://127.0.0.1:9701' };

function brokerHttp(base, pathname, { method = 'GET', body = null, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathname);
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(
      { method, host: u.hostname, port: u.port, path: u.pathname + u.search, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {} },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) });
          } catch (e) {
            resolve({ status: res.statusCode, json: null, text });
          }
        });
      }
    );
    r.setTimeout(timeoutMs, () => r.destroy(new Error('broker timeout')));
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/**
 * Gmail aliases exist in two forms of the *same* mailbox: `user@gmail.com`
 * (plain) and `u.s.e.r@gmail.com` (dotted) — both deliver to one inbox.
 * Measured (2026-10-15, five panels): the dotted form is read as a disposable sub-address and refused,
 * while the plain form is accepted. Emailnator hands out the dotted variant as
 * the box identity, so the reader keys on it — but what goes into a register
 * form must be the plain one.
 */
const gmailForms = (addr) => {
  const m = /^([^@]+)@(gmail\.com|googlemail\.com)$/i.exec(String(addr || '').trim());
  if (!m) return { plain: addr, dotted: addr, isGmail: false };
  const base = m[1].replace(/\./g, '');
  const dotted = base.length > 1 ? base.split('').join('.') : base;
  return { plain: `${base}@${m[2]}`, dotted: `${dotted}@${m[2]}`, isGmail: true };
};
/** The form a panel's register form should receive. Non-gmail passes through. */
const plainGmail = (addr) => gmailForms(addr).plain;

const Mail = {
  /** `folder` = provider-scoped Mailtrap folder, `tag` = short provider tag. */
  async create({ provider = 'mailtrap', folder, tag, tries = 4 } = {}) {
    const base = BROKERS[provider] || BROKERS.mailtrap;
    let last = null;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await brokerHttp(base, '/create', { method: 'POST', body: { folder, tag } });
        if (res.status === 200 && res.json && res.json.address) return { ...res.json, provider };
        last = new Error(`broker /create ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
      } catch (e) {
        last = e;
      }
      await sleep(2500 + i * 2500);
    }
    throw last;
  },
  async list(box) {
    const base = BROKERS[box.provider] || BROKERS.mailtrap;
    const res = await brokerHttp(base, `/list?token=${encodeURIComponent(box.token)}`);
    return (res.json && res.json.messages) || [];
  },
  async read(box, id) {
    const base = BROKERS[box.provider] || BROKERS.mailtrap;
    const res = await brokerHttp(base, `/read?id=${encodeURIComponent(id)}&token=${encodeURIComponent(box.token)}`);
    return (res.json && res.json) || {};
  },
  /** Polls the inbox until `extract(text)` returns something truthy. */
  async waitCode(box, extract, { timeoutMs = 240000, pollMs = 5000, from = null, since = 0 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      let msgs = [];
      try {
        msgs = await Mail.list(box);
      } catch (e) {
        /* broker hiccup — keep polling */
      }
      for (const m of msgs) {
        if (from && !String(m.from || '').toLowerCase().includes(from)) continue;
        let text = `${m.subject || ''}\n${m.text || ''}`;
        // HTML-only mails are the norm for these panels (measured: OrcaRouter's
        // verification mail has an empty `text_body` and the code only inside
        // `html_body` — the reader that ignored HTML held a *delivered* code
        // behind a "no code arrived" wall for a whole lane).
        if (!m.text || !/[\dA-Za-z]{4,}/.test(m.text)) {
          try {
            const full = await Mail.read(box, m.id);
            if (full.text && /[\dA-Za-z]{4,}/.test(full.text)) text = `${full.subject || ''}\n${full.text}`;
            else if (full.html) text = `${full.subject || ''}\n${flattenHtml(full.html)}`;
          } catch (e) {
            /* keep the list version */
          }
        }
        const code = extract(text);
        if (code) return { code, message: m, text };
      }
      await sleep(pollMs);
    }
    return null;
  },
};

/** Strip an HTML body down to text: mails from these panels are HTML-only
 *  (measured: OrcaRouter — `text_body` empty, code inside `html_body`). */
function flattenHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verification codes in these mails are 4–8 digits *or* short alphanumeric
 * tokens (measured: AIAIAI's own code is 6-char hex, `6d47c5`), but a naive
 * "first 6-digit number" grab picks up timestamps/order ids from the footer
 * (measured: AIAIAI register answered "Verification code is incorrect or has
 * expired" while the mail had been received). Prefer the code next to the words
 * that introduce it, then a mixed alphanumeric token right after a keyword.
 */
function extractCode(text) {
  const blob = String(text || '').replace(/<[^>]+>/g, ' ');
  // Codes are introduced by a keyword ("验证码 131641", "code: 131641", "为 131641").
  // A mail can quote an older code above the new one, and a body can carry both a
  // 4-digit fragment and the real 6-digit code, so among the keyword-adjacent
  // candidates take the **longest** (ties: earliest) instead of the first hit —
  // "first digit run in the mail" is what produced wrong-code refusals before.
  const anchored = [
    // The boundary lookahead matters: Jasper's code was `8050ed` and the digit
    // tier matched its `8050` prefix (measured, register refused with 8050).
    /(?:验证码|校验码|动态码|验证)?\s*(?:is|为|是|:：)\s*([0-9]{4,8})(?![0-9A-Za-z])/gi,
    /(?:code|verification|验证码|验证|код)[^0-9]{0,24}?([0-9]{4,8})(?![0-9A-Za-z])/gi,
  ];
  const hits = [];
  for (const re of anchored) {
    for (const m of blob.matchAll(re)) hits.push({ code: m[1], at: m.index });
  }
  if (hits.length) {
    hits.sort((a, b) => b.code.length - a.code.length || a.at - b.at);
    return hits[0].code;
  }
  // "Your verification code is: a51d1f" (measured 2026-10-15: Jasper/yjs.im and
  // Wxctf Ai mail both use this template): an alphanumeric code with an ordinary
  // connective word ("is") between the keyword and the token — both the digit
  // tiers above and the punctuation-only mixed scan below miss it. Allow a short
  // connective here and require the token to be mixed, so a phrase like
  // "code is valid" cannot yield the word "valid" as the code.
  const connective = [];
  for (const m of blob.matchAll(/(?:verification\s*code|验证码|校验码|动态码|\b(?:code|otp)\b|код)[\s:：=,.。]{0,4}(?:is|are|was|是|为|as)?[\s:：=,.。]{0,4}([0-9A-Za-z]{4,8})(?![0-9A-Za-z])/gi)) {
    const tok = m[1];
    if (!/[0-9]/.test(tok) || !/[A-Za-z]/.test(tok)) continue;
    connective.push({ code: tok, at: m.index });
  }
  if (connective.length) {
    connective.sort((a, b) => a.at - b.at);
    return connective[0].code;
  }
  // Alphanumeric codes exist: AIAIAI's own mail says
  // `您的验证码为: <strong>6d47c5</strong>` — the digit-only tiers above never
  // match it (that is why earlier runs read *someone else’s* numeric
  // code out of a shared box). Scan tokens, keep the mixed ones (≥1 letter AND
  // ≥1 digit — cannot shadow a numeric code or match an ordinary word) that sit
  // within 40 chars behind a code keyword, earliest first.
  const KEYWORD = /(?:验证码|校验码|动态码|验证|код|code|verification|otp)/gi;
  const kwEnds = [...blob.matchAll(KEYWORD)].map((m) => m.index + m[0].length);
  const mixed = [];
  for (const m of blob.matchAll(/[0-9A-Za-z]{4,8}(?![0-9A-Za-z])/g)) {
    if (!/[0-9]/.test(m[0]) || !/[A-Za-z]/.test(m[0])) continue;
    if (kwEnds.some((k) => k <= m.index && m.index - k <= 40 && !/[0-9A-Za-z]/.test(blob.slice(k, m.index)))) {
      mixed.push({ code: m[0], at: m.index });
    }
  }
  if (mixed.length) {
    mixed.sort((a, b) => a.at - b.at);
    return mixed[0].code;
  }
  for (const re of [/>\s*([0-9]{5,8})\s*</, /\b([0-9]{6})\b/]) {
    const m = blob.match(re);
    if (m) return m[1];
  }
  return null;
}

// --------------------------------------------------------------------------- files

function providerDir(name) {
  const dir = path.join(ROOT, 'providers', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  return dir;
}

function readJson(file, dflt = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return dflt;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** Appends to a newline log without ever throwing (logging must not break a mint). */
function appendLine(file, line) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line + '\n');
  } catch (e) {
    /* ignore */
  }
}

module.exports = {
  ROOT,
  sleep,
  jitter,
  nowIso,
  randHex,
  randPass,
  req,
  jreq,
  isExitError,
  ExitPool,
  exitIp,
  loadExits,
  Mail,
  gmailForms,
  plainGmail,
  extractCode,
  flattenHtml,
  providerDir,
  readJson,
  writeJson,
  appendLine,
  BROKERS,
  DEFAULT_POOLS,
};
