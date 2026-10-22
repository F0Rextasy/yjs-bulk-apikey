#!/usr/bin/env node
'use strict';

/**
 * Connect yjs.im to a 9Router instance.
 *
 * yjs.im ships an OpenAI-compatible endpoint (https://api.yjs.im/v1), so a single
 * connection is enough: register one `openai-compatible` provider-node with
 * prefix `yjs`, then attach a connection that carries one of your
 * yjs.im API keys. Rotate keys by calling this again with a different
 * --api-key — the node stays, every key becomes another connection.
 *
 * Usage:
 *   node src/connect-9router.js \
 *     --base http://localhost:20128 --password 123456 \
 *     --api-key yjs_xxxxxxxx [--name "yjs.im"] [--prefix yjs]
 *
 * Options:
 *   --base <url>       9Router base URL (default http://localhost:20128)
 *   --password <pw>    9Router admin password (default 123456)
 *   --api-key <key>    yjs.im API key (or env NINEROUTER_API_KEY)
 *   --name <label>     connection label (default yjs.im)
 *   --prefix <slug>    9Router model prefix (default yjs)
 *   --base-url <url>   upstream base URL (default https://api.yjs.im/v1)
 *   --model <id>       default model (default deepseek-v4-flash-0731)
 *   --help             this text
 *
 * Zero dependencies. Node.js >= 18.
 */

const UA = 'yjs-bulk-apikey-9router-connector/1.0';

const DEFAULTS = {
  base: 'http://localhost:20128',
  password: '123456',
  name: 'yjs.im',
  prefix: 'yjs',
  baseUrl: 'https://api.yjs.im/v1',
  defaultModel: 'deepseek-v4-flash-0731',
};

async function login9router(base, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ password: password ?? DEFAULTS.password }),
  });
  // `Headers.getSetCookie()` is Node >= 18.14 (undici 5.19) while this package
  // says node >= 18: without the fallback the jar stays empty on an older 18.x,
  // the login still reports ok, and every following call answers 401.
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  return { ok: res.ok, cookie, body: (await res.text()).slice(0, 200) };
}

async function api(base, cookie, route, init = {}) {
  const res = await fetch(`${base}${route}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON answers are reported as text */
  }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
}

async function ensureNode(base, cookie, { name, prefix, baseUrl }) {
  const list = await api(base, cookie, '/api/provider-nodes');
  const nodes = (list.json && list.json.nodes) || [];
  const existing = nodes.find((n) => n.name === name || n.prefix === prefix);
  if (existing) {
    console.log(`provider-node exists: ${existing.id} (prefix ${existing.prefix})`);
    return existing;
  }
  const created = await api(base, cookie, '/api/provider-nodes', {
    method: 'POST',
    body: JSON.stringify({ name, prefix, apiType: 'chat', type: 'openai-compatible', baseUrl }),
  });
  if (!created.ok) throw new Error(`create node failed ${created.status}: ${created.text}`);
  console.log(`provider-node created: ${created.json.node.id}`);
  return created.json.node;
}

async function ensureConnection(base, cookie, { nodeId, name, apiKey, defaultModel }) {
  const list = await api(base, cookie, '/api/providers');
  const conns = (list.json && list.json.connections) || [];
  const existing = conns.find((c) => c.provider === nodeId && c.name === name);
  if (existing) {
    console.log(`connection exists: ${existing.id} (${existing.name}) — pass --name "<label>" to attach another key`);
    return existing;
  }
  const created = await api(base, cookie, '/api/providers', {
    method: 'POST',
    body: JSON.stringify({ provider: nodeId, apiKey, name, priority: 1, defaultModel: defaultModel || null }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`create connection failed ${created.status}: ${created.text}`);
  }
  console.log(`connection created: ${(created.json && created.json.connection && created.json.connection.id) || '(conflict)'}`);
  return created.json && created.json.connection;
}

/**
 * Register the yjs.im node and attach `apiKey` as a connection.
 * `name` is the connection label: pass a distinct one per key ("yjs.im 01", …)
 * so the same node can hold as many keys as you minted.
 */
async function connectYjs({
  base = DEFAULTS.base,
  password = DEFAULTS.password,
  apiKey,
  name = DEFAULTS.name,
  prefix = DEFAULTS.prefix,
  baseUrl = DEFAULTS.baseUrl,
  defaultModel = DEFAULTS.defaultModel,
} = {}) {
  if (!apiKey) throw new Error('--api-key is required');
  const { cookie, ok, body } = await login9router(base, password);
  console.log(`9Router login: ${ok ? 'ok' : 'not required/failed'} ${ok ? '' : body}`);
  const node = await ensureNode(base, cookie, { name: prefix, prefix, baseUrl });
  await ensureConnection(base, cookie, { nodeId: node.id, name, apiKey, defaultModel });
  console.log(`\nDone. Model prefix: ${prefix}/  ·  default: ${prefix}/${defaultModel}`);
  return node;
}

if (require.main === module) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  if (args.help) {
    const doc = require('fs').readFileSync(__filename, 'utf8');
    console.log(doc.slice(doc.indexOf('/**'), doc.indexOf('*/') + 2));
    process.exit(0);
  }
  connectYjs({
    base: args.base,
    password: args.password,
    apiKey: args['api-key'] || process.env.NINEROUTER_API_KEY,
    name: args.name,
    prefix: args.prefix,
    baseUrl: args['base-url'],
    defaultModel: args.model,
  }).catch((e) => {
    console.error('[fatal] ' + e.message);
    process.exit(1);
  });
}

module.exports = { connectYjs, login9router, ensureNode, ensureConnection };
