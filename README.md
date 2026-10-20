<div align="center">

```
██╗   ██╗   ██╗███████╗
╚██╗ ██╔╝   ██║██╔════╝
 ╚████╔╝    ██║███████╗
  ╚██╔╝██   ██║╚════██║
   ██║ ╚█████╔╝███████║
   ╚═╝  ╚════╝ ╚══════╝
```

# yjs-bulk-apikey

**Bulk-create yjs.im accounts with auto-generated API keys — OpenAI-compatible inference + 9Router connector.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 Quick start](#-quick-start) · [✅ Verified](#-verified-working--every-key-is-tested) · [🧭 How it works](#-how-it-works) · [🤖 Models & free tier](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ Options](#️-cli-options) · [🛰️ Proxies](#️-behind-a-proxy) · [🐞 Issues](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **One account, one key.** N accounts → N keys, one sign-up each, every key verified live
> before it lands in `keys.txt`.

## ✨ What this does

Jasper (`api.yjs.im`) hands every account a free quota — the usable unit is *one account per key*,
because the quota lives on the **account**, never on a second key of the same account. Sign-up is
open, e-mail verification is live, and the panel runs a **daily check-in** that tops the account up.
This tool walks the whole path unattended — fresh mailbox, sign-up, check-in, key creation, live
verification — over your proxy list, and appends a key to `keys.txt` only after a real completion.

```
proxies.txt ──▶ exit screened against api.yjs.im (each fresh exit is proven before it is spent)
                    │
                    ▼
   fresh verification address ──▶ GET /api/verification ──▶ code mail (read from the body)
        │                                                          │
        ▼                                                          ▼
   POST /api/user/register ──▶ login ──▶ daily checkin ──▶ POST /api/token/
                                                              └─▶ reveal ─▶ group `Free`
                                                                               │
        keys.txt  ◀── live verify: GET /v1/models 200 + POST /v1/chat/completions 200 ──┘
```

## 🛠 Quick start

```bash
git clone https://github.com/F0Rextasy/yjs-bulk-apikey.git
cd yjs-bulk-apikey

# 1) your proxy list — one exit per line (http://, socks5://, socks4://, or bare host:port)
#    optional: without it the tool connects directly
printf 'socks5://127.0.0.1:1080\n' > proxies.txt

# 2) go — one run mints one key per fresh account
node src/launcher.js                 # interactive menu: mint / settings
# or drive it directly:
node src/cli.js mint --count 30 --conc 2
```

Everything the tools write lands **next to the code**: `src/keys.txt`, `src/accounts.json`,
`src/out/`. The pool (`src/proxies.txt`) is optional — with none the tool connects directly.

`node src/cli.js help` lists the tasks;
 every task takes its own flags — ask it directly
(`node src/mint.js --help`). Keys land in `keys.txt`, one per line; per-account detail (e-mail,
steps, verify result) lands in `accounts.json`. Settings from the launcher persist in
`launcher.config.json`.

## ✅ Verified working — every key is tested

A key is written to `keys.txt` only after the live API answers with it:

| check | call | expected |
|---|---|---|
| auth + model list | `GET https://api.yjs.im/v1/models` | `200` + the account's model ids (14 on the `Free` group) |
| real completion | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + the assistant message |

The batch this repository shipped from: **3 distinct accounts → 3 keys, every one verified**
(`models` 200 + `deepseek-v4-flash-0731` chat 200), each re-checked from an exit **different** from
the one that minted it.

## 🧭 How it works

Per account, end to end over one exit (direct when no pool is configured):

1. a fresh exit from `proxies.txt`, proven against the panel right then (a dead exit costs one
   attempt, not the batch);
2. a fresh verification mailbox per account — these panels accept real mailbox domains, so the tool
   registers one and reads the code from the message body;
3. `GET /api/verification?email=…` → the code mail → `POST /api/user/register`;
4. `POST /api/user/login` → session → `POST /api/user/checkin` (daily quota top-up);
5. `POST /api/token/` → the token is created **unlimited** and its plaintext is read from the reveal
   route (the create answer is masked);
6. the token's group is set to **`Free`** — the group that serves the 14 models below;
7. the key is captured, then verified live (`/v1/models` + a chat completion) and appended to
   `keys.txt` + `accounts.json`.

## 🤖 Models & free tier

`models.json` is the live `GET /v1/models` answer of a minted key on the `Free` group — **14 ids**:

|Model|✓|
|---|---|
|`deepseek-v4-flash-0731`|✓|
|`DeepSeek-V4-Flash`|✓|
|`DeepSeek-V4-Flash-0731`|✓|
|`claude-opus-5-5-web`|✓|
|`deepseek-v4-flash`|✓|
|`deepseek-v4.1-flash`|✓|
|`deepseek-v4.1-flash-request`|✓|
|`glm-5.2`|✓|
|`glm-5.3`|✓|
|`glm-5.3-flash`|✓|
|`hy3`|✓|
|`kimi-k3`|✓|
|`mimo-v2.6-flash`|✓|
|`qwen3.8-flash-next`|✓|
|`sensenova-6.8-flash-lite`|✓|
|`step-5-preview`|✓|

2026-10-19 live re-check: 16/16 probed ids answered a chat `200` (the panel serves the case-variant duplicates above as separate ids).

**What a fresh account gets:** a free quota measured at **5,595–7,216 units** after the first
**daily check-in** (which tops the account up — check in again tomorrow and it refills). The panel's
full catalogue is larger; what a key can call is exactly what its group serves, and this repository's
keys are on `Free`.

**How to get more:** the quota lives on the account — one account per key. `--count N` mints N
accounts, each with its own key, its own quota and its own daily check-in.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 Connect to 9Router

The keys this tool mints are ordinary OpenAI-compatible credentials, so a local
9Router instance can serve them like any other provider: one `openai-compatible`
node for yjs.im, one connection per key.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

The launcher menu and the CLI dispatcher drive the same connector:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

Defaults: base `http://localhost:20128`, password `123456`, model prefix
`yjs`, node `yjs`, upstream `https://api.yjs.im/v1`, default model
`deepseek-v4-flash-0731`. Register another minted key with `--name "<label 2>"` — the node stays and
every key becomes another connection 9Router can load-balance across. Then pick a model inside
9Router:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI options

| task | flags |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — plus the engine's own flags (`node src/mint.js --help`) |
| `launcher.js` | interactive: mint / settings (count, concurrency) — persisted in `launcher.config.json` |

## 🛰️ Behind a proxy

**Optional — recommended at scale (per-IP limits, bans).** The tool works without a proxy too.

- **With a pool:** pass `--pool <file>` (the launcher uses `proxies.txt`) and every request goes through
  a proven exit from that list — one account stays pinned to one exit for its whole life, and a dead line
  fails that attempt so the tool moves to the next one (fail-closed while a pool is provided; exits are
  re-probed at use).
- **Without a pool:** the CLI prints `running WITHOUT a proxy (direct)` and connects directly — panel and
  mailbox traffic alike. Nothing about sign-up, check-in, key minting or verification changes; only where
  the packets leave from.
- `proxies.txt` — one exit per line; `scheme://user:pass@host:port`, `scheme://host:port` or bare
  `host:port` (defaults to `http://`). Comments after `#` and blank lines are ignored.
- Exits are proven against the panel **at the moment of use**; dead ones are retired and the pool
  is only re-read when the usable set runs dry.

## 🐞 Issues

Open an issue with the failing step, the exit used and the tool's stdout — the per-account dumps in
`accounts.json` and `outputs/` make failures reproducible without leaking a key.

## 📄 License

MIT — see [LICENSE](LICENSE). Use it on accounts you are allowed to create.

---
