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

**yjs.im アカウントを自動生成された API キー付きで一括作成 — OpenAI 互換推論 + 9Router コネクタ。**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)
[![OmniRoute](https://img.shields.io/badge/OmniRoute-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-omniroute)

[🛠 クイックスタート](#-quick-start) · [✅ 検証済み](#-verified-working--every-key-is-tested) · [🧭 仕組み](#-how-it-works) · [🤖 モデルと無料枠](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [🔌 OmniRoute](#-connect-to-omniroute) · [⚙️ オプション](#️-cli-options) · [🛰️ プロキシ](#️-behind-a-proxy) · [🐞 問題](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **1アカウント、1キー。** N アカウント → N キー、サインアップは各1回、すべてのキーは `keys.txt` に入る前にライブ検証されます。

## ✨ これは何をするか

Jasper（`api.yjs.im`）は全アカウントに無料枠を付与します — 利用可能な単位は*1アカウントにつき1キー*です。クォータは**アカウント**に紐づき、同一アカウントの2つ目のキーには決して紐づかないためです。サインアップは開放制で、メール認証はライブで動作し、パネルはアカウントを補充する**デイリーチェックイン**を実行します。このツールはその全経路を無人で進めます — 新しいメールボックス、サインアップ、チェックイン、キー作成、ライブ検証 — をプロキシリスト上で行い、実際の補完が成功した後にのみ `keys.txt` にキーを追記します。

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

## 🛠 クイックスタート

```bash
git clone https://github.com/F0Rextasy/yjs-bulk-apikey.git
cd yjs-bulk-apikey

# 1) your proxy list — one exit per line (http://, socks5://, socks4://, or bare host:port)
printf 'socks5://127.0.0.1:1080\n' > proxies.txt

# 2) go — one run mints one key per fresh account
node src/launcher.js                 # interactive menu: mint / settings

# or drive it directly:
node src/cli.js mint --count 30 --conc 2
```

ツールが書き出すものはすべて**コードの隣**に置かれます: `src/keys.txt`、`src/accounts.json`、`src/out/`。プールは `src/proxies.txt` から読み込まれます。

`node src/cli.js help` でタスク一覧を表示します。各タスクは独自のフラグを受け取るので、直接尋ねてください（`node src/mint.js --help`）。キーは `keys.txt` に1行1つで入り、アカウントごとの詳細（メール、ステップ、検証結果）は `accounts.json` に入ります。ランチャーの設定は `launcher.config.json` に永続化されます。

## ✅ 検証済みで動作 — すべてのキーがテストされます

キーは、ライブ API がそのキーで応答した後にのみ `keys.txt` に書き込まれます:

| チェック | 呼び出し | 期待値 |
|---|---|---|
| 認証 + モデル一覧 | `GET https://api.yjs.im/v1/models` | `200` + アカウントのモデル ID（`Free` グループでは14） |
| 実際の補完 | `POST https://api.yjs.im/v1/chat/completions`（`deepseek-v4-flash-0731`） | `200` + アシスタントメッセージ |

このリポジトリが出荷したバッチ: **3つの異なるアカウント → 3つのキー、すべて検証済み**（`models` 200 + `deepseek-v4-flash-0731` chat 200）、それぞれ発行に使ったものとは**異なる**出口から再チェック済み。

## 🧭 仕組み

1アカウントにつき、1つの出口を介して最初から最後まで:

1. `proxies.txt` から新しい出口を取得し、その時点でパネルに対して検証します（死んだ出口は1回の試行を消費するだけで、バッチ全体には影響しません）。
2. アカウントごとに新しい認証用メールボックス — これらのパネルは実在のメールボックスドメインを受け付けるため、ツールは1つ登録し、メッセージ本文からコードを読み取ります。
3. `GET /api/verification?email=…` → コードメール → `POST /api/user/register`
4. `POST /api/user/login` → セッション → `POST /api/user/checkin`（デイリークォータの補充）
5. `POST /api/token/` → トークンは**無制限**で作成され、その平文は reveal ルートから読み取られます（作成時の応答はマスクされています）。
6. トークンのグループを **`Free`** に設定します — 以下の14モデルを提供するグループです。
7. キーを取得し、ライブ検証（`/v1/models` + チャット補完）してから `keys.txt` + `accounts.json` に追記します。

## 🤖 モデルと無料枠

`models.json` は `Free` グループ上の発行済みキーによるライブ `GET /v1/models` の応答です — **14 ID**:

|モデル|✓|
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

2026-10-19 のライブ再チェック: プローブした16/16の ID がチャット `200` を返しました（パネルは上記の大文字小文字違いの重複を別 ID として提供しています）。

**新しいアカウントで得られるもの:** 最初の**デイリーチェックイン**後で **5,595〜7,216 ユニット**と測定された無料クォータ（チェックインはアカウントを補充します — 明日またチェックインすれば再び補充されます）。パネルの全カタログはより大きくなります。キーが呼び出せるのは、そのグループが提供するものだけであり、このリポジトリのキーは `Free` 上にあります。

**もっと得る方法:** クォータはアカウントに紐づきます — 1アカウントにつき1キーです。`--count N` は N 個のアカウントを発行し、それぞれが独自のキー、独自のクォータ、独自のデイリーチェックインを持ちます。

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 9Router に接続

このツールが発行するキーは通常の OpenAI 互換資格情報なので、ローカルの 9Router インスタンスは他のプロバイダと同様にそれらを扱えます: yjs.im 用の `openai-compatible` ノード1つ、キーごとに接続1つ。

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

ランチャーメニューと CLI ディスパッチャも同じコネクタを駆動します:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

デフォルト: ベース `http://localhost:20128`、パスワード `123456`、モデルプレフィックス `yjs`、ノード `yjs`、上流 `https://api.yjs.im/v1`、デフォルトモデル `deepseek-v4-flash-0731`。別の発行済みキーを `--name "<label 2>"` で登録します — ノードはそのまま残り、すべてのキーが 9Router が負荷分散できる別の接続になります。次に 9Router 内でモデルを選択します:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## 🔌 OmniRoute に接続

このツールが発行するキーは通常の OpenAI 互換資格情報なので、ローカルの OmniRoute インスタンスは他のプロバイダと同様にそれらを扱えます: yjs.im 用の `openai-compatible` ノード1つ、キーごとに接続1つ。

```bash
node src/connect-omniroute.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

ランチャーメニューと CLI ディスパッチャも同じコネクタを駆動します:

```bash
node src/launcher.js --connect-omniroute    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-omniroute.js --help        # every flag and default
```

デフォルト: ベース `http://localhost:20128`、パスワード `123456`、モデルプレフィックス `yjs`、ノード `yjs`、上流 `https://api.yjs.im/v1`、デフォルトモデル `deepseek-v4-flash-0731`。別の発行済みキーを `--name "<label 2>"` で登録します — ノードはそのまま残り、すべてのキーが OmniRoute が負荷分散できる別の接続になります。次に OmniRoute 内でモデルを選択します:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI オプション

| タスク | フラグ |
|---|---|
| `mint` | `--count N`（30）· `--conc N`（2）— さらにエンジン自身のフラグ（`node src/mint.js --help`） |
| `launcher.js` | 対話式: 発行 / 設定（カウント、同時実行数）— `launcher.config.json` に永続化 |

## 🛰️ プロキシの背後で

* `proxies.txt` — 1行に1つの出口。`scheme://user:pass@host:port`、`scheme://host:port`、または素の `host:port`（デフォルトは `http://`）。`#` 以降のコメントと空行は無視されます。
* 出口は**使用時点**でパネルに対して検証されます。死んだものは退役し、プールは使用可能なセットが尽きたときだけ再読み込みされます。
* あなたのインターフェースの外には何も出ません: すべてのパネルリクエスト（およびメールボックスのトラフィック）はプールを経由します。

## 🐞 問題

失敗したステップ、使用した出口、ツールの stdout を添えて issue を開いてください — `accounts.json` と `outputs/` のアカウントごとのダンプにより、キーを漏らさずに失敗を再現できます。

## 📄 ライセンス

MIT — [LICENSE](LICENSE) を参照。作成が許可されているアカウントでのみ使用してください。

---