'use strict';

/**
 * New API (and fork) client used by the bulk mints.
 *
 * Every call goes through an exit from the pool; the client keeps the panel
 * session as a `Cookie` string plus the `New-Api-User` header the fork needs for
 * `/api/*`, and re-picks an exit whenever the transport (not the panel) fails.
 *
 * Endpoint shapes differ between forks, so nothing is assumed: `probe()` asks
 * the live panel which register/verification routes exist before the mint uses
 * them, and the results land in the provider's report.
 */

const { req, sleep } = require('./lib');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

class Panel {
  constructor(base, pool, { log = () => {}, label = 'panel' } = {}) {
    this.base = base.replace(/\/$/, '');
    this.pool = pool;
    this.log = log;
    this.label = label;
    this.cookie = '';
    this.userId = null;
    this.accessToken = null;
    this.lastExit = null;
  }

  headers(extra = {}, auth = false) {
    const h = {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      'user-agent': UA,
      ...extra,
    };
    // The panel's session cookie belongs to every call, not just the
    // authenticated ones: some forks keep the pending verification code in a
    // server-side session that `sendCode` opens, and a `register` that arrives
    // without the cookie is answered "Verification code is incorrect or has
    // expired" even though the code is right.
    if (this.cookie) h.cookie = this.cookie;
    // Measured 2026-10-15 (Leo Studio fork): the session cookie alone answers
    // `401 {"code":"AUTH_UNAUTHORIZED","message":"Unauthorized, invalid access
    // token"}` for self/checkin/token — the login's `data.access_token` (JWT)
    // must ride as a Bearer token. Standard New API forks return no
    // access_token, so this changes nothing for them. `new-api-user` is only
    // sent when the id is actually known (an empty header is rejected by some
    // forks, and the id is unknown until login/self answers).
    if (auth && this.accessToken) h.authorization = `Bearer ${this.accessToken}`;
    if (auth && this.userId) h['new-api-user'] = String(this.userId);
    return h;
  }

  cookiesFrom(res) {
    const raw = res.headers['set-cookie'];
    if (!raw || !raw.length) return;
    const jar = new Map(
      this.cookie
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => [s.split('=')[0], s])
    );
    for (const c of raw) {
      const pair = c.split(';')[0];
      const name = pair.split('=')[0];
      if (!name) continue;
      const val = pair.split('=').slice(1).join('=');
      if (val === '' || /^(session|token|access_token|user)$/i.test(name) === false && val === '') continue;
      jar.set(name, pair);
    }
    this.cookie = [...jar.values()].join('; ');
  }

  /** One API call through a fresh exit per attempt; panel answers are returned. */
  async call(pathname, { method = 'GET', body = null, auth = false, tries = 6, headers = {}, raw = false, timeoutMs = 18000 } = {}) {
    const url = this.base + pathname;
    return this.pool.attempt(
      async (p) => {
        const res = await req(p, url, {
          method,
          body,
          headers: this.headers(headers, auth),
          timeoutMs,
          connectTimeoutMs: 8000,
          agent: this.agent || null,
        });
        this.cookiesFrom(res);
        this.lastExit = p.line;
        if (raw) return res;
        let json = null;
        try {
          json = JSON.parse(res.text);
        } catch (e) {
          json = null;
        }
        return { status: res.status, json, text: res.text, headers: res.headers, exit: p.line };
      },
      { tries, label: `${method} ${pathname}` }
    );
  }

  async status() {
    const r = await this.call('/api/status', { tries: 8, timeoutMs: 25000 });
    return r;
  }

  /** Which register-related routes does this fork actually have? */
  async probe() {
    const out = {};
    const get = async (name, pathname, opts = {}) => {
      try {
        const r = await this.call(pathname, { tries: 3, timeoutMs: 20000, ...opts });
        out[name] = { path: pathname, method: opts.method || 'GET', status: r.status, body: (r.text || '').slice(0, 300) };
      } catch (e) {
        out[name] = { path: pathname, method: opts.method || 'GET', error: String(e.message).slice(0, 160) };
      }
    };
    await get('registerPage', '/register');
    await get('console', '/console');
    await get('status', '/api/status');
    await get('models', '/v1/models');
    await get('verification', '/api/verification?email=probe%40example.com');
    await get('verificationSend', '/api/verification/send', { method: 'POST', body: { email: 'probe@example.com' } });
    await get('registerPost', '/api/user/register', { method: 'POST', body: {} });
    await get('checkin', '/api/user/checkin', { method: 'GET' });
    await get('checkinPost', '/api/user/checkin', { method: 'POST', body: {} });
    await get('setup', '/api/setup');
    await get('oauthGithub', '/api/oauth/github');
    return out;
  }

  async sendCode(email, { turnstile = '', tries = 20 } = {}) {
    // some forks want POST with a JSON body instead of a query string
    const attempts = [
      { path: `/api/verification?email=${encodeURIComponent(email)}${turnstile ? `&turnstile=${encodeURIComponent(turnstile)}` : ''}`, method: 'GET', body: null },
      { path: '/api/verification', method: 'POST', body: { email, turnstile } },
      { path: '/api/user/register/verify', method: 'POST', body: { email, turnstile } },
    ];
    const seen = [];
    for (const a of attempts) {
      let r = null;
      try {
        r = await this.call(a.path, { method: a.method, body: a.body, tries, timeoutMs: 30000 });
      } catch (e) {
        seen.push({ tried: `${a.method} ${a.path.split('?')[0]}`, error: String(e.message).slice(0, 160) });
        continue;
      }
      const msg = (r.json && (r.json.message || (r.json.error && r.json.error.message))) || String(r.text || '').slice(0, 200);
      const ok = r.json && r.json.success === true;
      seen.push({ tried: `${a.method} ${a.path.split('?')[0]}`, status: r.status, ok, message: msg, exit: r.exit });
      if (ok) return { ...r, attempts: seen, tried: seen[seen.length - 1].tried };
      // "already sent" style answers mean the route exists and worked
      if (r.status < 400 && msg && /sent|已发送|发送成功|成功/.test(String(msg))) return { ...r, attempts: seen, tried: seen[seen.length - 1].tried };
      if (/turnstile|captcha|验证/i.test(String(msg))) return { ...r, attempts: seen, tried: seen[seen.length - 1].tried };
    }
    const last = seen[seen.length - 1] || {};
    return { status: last.status || 0, json: { attempts: seen }, text: last.message || '', attempts: seen, tried: last.tried };
  }

  async register({ username, password, email, code, aff = '', turnstile = '', tries = 20 }) {
    const body = { username, password, email, verification_code: code, aff_code: aff, turnstile };
    return this.call('/api/user/register', { method: 'POST', body, tries, timeoutMs: 40000 });
  }

  async login({ username, password, tries = 20 }) {
    const r = await this.call('/api/user/login', { method: 'POST', body: { username, password }, tries, timeoutMs: 30000 });
    if (r.json && r.json.data) {
      this.userId = r.json.data.id || r.json.data.user_id || (r.json.data.user && r.json.data.user.id) || this.userId;
      if (r.json.data.access_token) this.accessToken = r.json.data.access_token;
    }
    return r;
  }

  async self(tries = 5) {
    const r = await this.call('/api/user/self', { auth: true, tries, timeoutMs: 30000 });
    if (r.json && r.json.data && r.json.data.id && !this.userId) this.userId = r.json.data.id;
    return r;
  }

  async checkin(tries = 8) {
    const r = await this.call('/api/user/checkin', { method: 'POST', body: {}, auth: true, tries, timeoutMs: 30000 });
    return r;
  }

  async createToken(name = 'cw', tries = 20) {
    const body = {
      name,
      remain_quota: 0,
      expired_time: -1,
      // The quota lives on the account; a token capped at 0 is answered
      // "Invalid token" by the relay even when the account holds quota
      // (measured 2026-10-15: Leo Studio + yjs.im, three accounts each).
      unlimited_quota: true,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group: '',
    };
    const r = await this.call('/api/token/', { method: 'POST', body, auth: true, tries, timeoutMs: 40000 });
    let key = null;
    if (r.json) {
      key =
        (r.json.data && (r.json.data.key || r.json.data.token)) ||
        r.json.key ||
        null;
    }
    return { ...r, key };
  }

  async listTokens(tries = 20) {
    const r = await this.call('/api/token/?p=0&size=100', { auth: true, tries, timeoutMs: 30000 });
    const items = (r.json && r.json.data && (r.json.data.items || r.json.data)) || [];
    return { ...r, items: Array.isArray(items) ? items : [] };
  }

  /** Newer forks mask `key` in the list and expose it here (measured: 快跑API bundle). */
  async tokenKey(id, tries = 10) {
    const r = await this.call(`/api/token/${id}/key`, { method: 'POST', auth: true, tries, timeoutMs: 30000 });
    const key = (r.json && r.json.data && (r.json.data.key || r.json.data)) || null;
    return { ...r, key: typeof key === 'string' ? key : null };
  }

  /** Relay-side verification: the key must authenticate on this provider alone. */
  async models(key, { tries = 10, timeoutMs = 30000 } = {}) {
    const url = this.base + '/v1/models';
    return this.pool.attempt(
      async (p) => {
        const res = await req(p, url, { headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': UA }, timeoutMs, agent: this.agent || null });
        this.lastExit = p.line;
        let json = null;
        try {
          json = JSON.parse(res.text);
        } catch (e) {
          json = null;
        }
        return { status: res.status, json, text: res.text, exit: p.line };
      },
      { tries, label: 'GET /v1/models' }
    );
  }

  async chat(key, model, { tries = 10, timeoutMs = 90000, prompt = 'Reply with the single word: ok', maxTokens = 8 } = {}) {
    const url = this.base + '/v1/chat/completions';
    const body = { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false };
    return this.pool.attempt(
      async (p) => {
        const res = await req(p, url, {
          method: 'POST',
          body,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
          timeoutMs,
          agent: this.agent || null,
        });
        this.lastExit = p.line;
        let json = null;
        try {
          json = JSON.parse(res.text);
        } catch (e) {
          json = null;
        }
        return { status: res.status, json, text: res.text, exit: p.line };
      },
      { tries, label: 'POST /v1/chat/completions' }
    );
  }
}

/** Pull the fields the mint cares about out of a fork's `/api/status` payload. */
function gates(statusJson) {
  const d = (statusJson && (statusJson.data || statusJson)) || {};
  const pick = (...names) => {
    for (const n of names) {
      if (d[n] !== undefined) return d[n];
      for (const key of Object.keys(d)) if (key.toLowerCase() === n.toLowerCase()) return d[key];
    }
    return undefined;
  };
  return {
    system_name: pick('system_name', 'SystemName', 'site_name'),
    register_enabled: pick('register_enabled', 'RegisterEnabled'),
    password_register: pick('password_register', 'PasswordRegister', 'pwd'),
    email_verification: pick('email_verification', 'EmailVerification', 'em'),
    github_oauth: pick('github_oauth', 'GitHubOAuth', 'github_oauth_enabled', 'gh'),
    linuxdo_oauth: pick('linuxdo_oauth', 'LinuxDOOAuth', 'ld'),
    wechat_oauth: pick('wechat_login', 'WeChatLogin'),
    turnstile_check: pick('turnstile_check', 'TurnstileCheck', 'turnstile_enabled', 'ts'),
    turnstile_site_key: pick('turnstile_site_key', 'TurnstileSiteKey'),
    checkin_enabled: pick('checkin_enabled', 'CheckinEnabled', 'ci'),
    telegram_oauth: pick('telegram_oauth', 'TelegramOAuth'),
    phone_verification: pick('phone_verification', 'PhoneVerification'),
    email_domain_restriction: pick('email_domain_restriction_enabled', 'email_suffix_whitelist', 'EmailSuffixWhitelist'),
    invite_required: pick('invite_code_required', 'InviteCodeRequired'),
    quota_per_unit: pick('quota_per_unit'),
    usd_exchange_rate: pick('usd_exchange_rate'),
    raw_keys: Object.keys(d).sort(),
  };
}

module.exports = { Panel, gates, UA };
