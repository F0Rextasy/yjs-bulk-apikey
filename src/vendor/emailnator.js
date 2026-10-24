'use strict';
/**
 * yjs-bulk-apikey · Emailnator inbox helper — the default mail rail of the mint.
 *
 * Emailnator hands out real @gmail.com mailboxes from a shared public pool; an
 * address is generated per account and polled for the panel's verification mail.
 * Emailnator is a third-party mailbox service, not the provider being signed up:
 * when the exits are down it is still fine to read it directly, so the fallback
 * here is not a provider-side leak.
 *
 * Vendored from the lab's `providers/cloudflare-wai/emailnator.js`; the only
 * change is the proxy import, which points at this repo's own `src/proxy.js`.
 */
const https = require('https');
const { URL } = require('url');
const { parseProxy, createAgent, label } = require('../proxy.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BASE = 'https://www.emailnator.com';
const HEADERS = { origin: BASE, referer: `${BASE}/`, 'User-Agent': UA, Accept: 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(url, { method = 'GET', headers = {}, body, proxy = null, timeoutMs = 30000 } = {}) {
  const px = typeof proxy === 'string' ? parseProxy(proxy) : proxy;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request(
      {
        method,
        host: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        agent: px ? createAgent(px) : undefined,
        headers: { ...HEADERS, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {}
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const asProxy = (p) => (typeof p === 'string' ? parseProxy(p) : p);

/** Generate a fresh gmail address; `plain` is the dot-free registration form. */
async function newAddress(proxy) {
  const res = await request(`${BASE}/api/generate-email`, { method: 'POST', body: { ids: [3] }, proxy: asProxy(proxy) });
  const dotted = res.json && res.json.email;
  if (!dotted || !/@gmail\.com$/i.test(dotted)) throw new Error(`emailnator generate: ${res.status} ${String(res.text).slice(0, 140)}`);
  const [local, domain] = dotted.split('@');
  return { dotted, plain: `${local.replace(/\./g, '')}@${domain}` };
}

/** The most recent messages on an address (Emailnator takes the plain form). */
async function listMessages(plain, proxy, { limit = 20 } = {}) {
  const res = await request(`${BASE}/api/message-list`, { method: 'POST', body: { email: plain, limit }, proxy: asProxy(proxy) });
  if (!res.json) throw new Error(`emailnator list: ${res.status} ${String(res.text).slice(0, 140)}`);
  return res.json.messages || [];
}

async function readMessage(id, proxy) {
  const res = await request(`${BASE}/api/message/${encodeURIComponent(id)}`, { proxy: asProxy(proxy) });
  return res.json || {};
}

/** Wait for a Cloudflare mail; return {subject, html, text, links}. */
async function waitForCloudflareMail(plain, proxy, { timeoutMs = 240000, pollMs = 6000, log = console.log } = {}) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  while (Date.now() < deadline) {
    let messages = [];
    try {
      messages = await listMessages(plain, proxy);
    } catch (e) {
      log(`  inbox poll error: ${e.message}`);
    }
    for (const m of messages) {
      const id = String(m.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const from = String(m.from || '');
      const subject = String(m.subject || '');
      if (!/cloudflare/i.test(from + ' ' + subject)) continue;
      const full = await readMessage(id, proxy);
      const html = String(full.content || '');
      const text = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]).filter((h) => /cloudflare\.com/.test(h));
      return { id, from, subject, html, text, links };
    }
    await sleep(pollMs);
  }
  throw new Error(`no cloudflare mail for ${plain} within ${timeoutMs}ms`);
}

/** Pick the email-verification link out of a Cloudflare mail. */
function verificationLink(mail) {
  const all = [...(mail.links || [])];
  const byPattern = all.find((h) => /verify|confirm|email-verification|activation/i.test(h));
  if (byPattern) return byPattern;
  const inText = /https:\/\/[^\s"<>]*dash\.cloudflare\.com[^\s"<>]*?token=[^\s"<>&]+/i.exec(mail.html || '');
  return inText ? inText[0] : null;
}

module.exports = { newAddress, listMessages, readMessage, waitForCloudflareMail, verificationLink, request };
