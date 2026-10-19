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

**yjs.im アカウントを自動生成の API キー付きで一括作成 — OpenAI 互換の推論 + 9Router コネクタ。**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 クイックスタート](#-quick-start) · [✅ 検証済み](#-verified-working--every-key-is-tested) · [🧭 仕組み](#-how-it-works) · [🤖 モデルと無料枠](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ オプション](#️-cli-options) · [🛰️ プロキシ](#️-behind-a-proxy) · [🐞 問題報告](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **1アカウントにつき1キー。** N 個のアカウント → N 本のキー、登録は1回ずつ、そしてすべてのキーは
> `keys.txt` に書き込まれる前に実際に検証されます。

## ✨ これは何をするのか

Jasper（`api.yjs.im`）はすべてのアカウントに無料クォータを付与します — 使える単位は *キー1本につきアカウント1つ* です。
クォータは **アカウント** に紐づき、同じアカウントの2本目のキーに紐づくことは決してないからです。登録は
オープンで、メール認証は実際に機能しており、パネルにはアカウントを補充する **デイリーチェックイン** があります。
このツールは、新しいメールボックスの用意、登録、チェックイン、キー作成、ライブ検証という全工程を、
プロキシリスト経由で無人で実行し、実際の補完が成功した後にのみ `keys.txt` にキーを追記します。

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

ツールが書き出すものはすべて **コードの隣** に置かれます: `src/keys.txt`、`src/accounts.json`、
`src/out/`。プロキシプールは `src/proxies.txt` から読み込まれます。

`node src/cli.js help` でタスクの一覧を表示します。
各タスクは独自のフラグを受け付けるので、直接問い合わせてください
（`node src/mint.js --help`）。キーは `keys.txt` に1行ずつ書き込まれ、アカウントごとの詳細（メールアドレス、
実行ステップ、検証結果）は `accounts.json` に書き込まれます。ランチャーで設定した内容は
`launcher.config.json` に保存されます。

## ✅ 動作検証済み — すべてのキーをテストしています

キーが `keys.txt` に書き込まれるのは、ライブ API がそのキーで応答した後だけです:

| チェック | 呼び出し | 期待値 |
|---|---|---|
| 認証 + モデル一覧 | `GET https://api.yjs.im/v1/models` | `200` + そのアカウントのモデル ID（`Free` グループでは14個） |
| 実際の補完 | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + アシスタントのメッセージ |

このリポジトリが出荷したバッチ: **3つの異なるアカウント → 3本のキー、そのすべてを検証済み**
（`models` 200 + `deepseek-v4-flash-0731` チャット 200）。それぞれ、作成したときとは **別の** 出口から
再チェックしています。

## 🧭 仕組み

アカウントごとに、1つの出口を経由して最初から最後まで:

1. `proxies.txt` から新しい出口を取得し、その場でパネルに対して疎通を確認します（死んだ出口は
   バッチ全体ではなく、1回の試行を消費するだけです）。
2. アカウントごとに新しい検証用メールボックスを用意します — これらのパネルは実際のメールボックスの
   ドメインを受け付けるため、ツールはメールボックスを1つ登録し、メッセージ本文からコードを読み取ります。
3. `GET /api/verification?email=…` → コードメール → `POST /api/user/register`。
4. `POST /api/user/login` → セッション → `POST /api/user/checkin`（デイリークォータの補充）。
5. `POST /api/token/` → トークンは **無制限** で作成され、その平文は reveal ルートから読み取ります
   （作成時の応答はマスクされています）。
6. トークンのグループを **`Free`** に設定します — 以下に示す14個のモデルを提供するグループです。
7. キーを取得したら、ライブで検証し（`/v1/models` + チャット補完）、`keys.txt` + `accounts.json` に
   追記します。

## 🤖 モデルと無料枠

`models.json` は、`Free` グループで作成したキーによる `GET /v1/models` の実際の応答です — **14個の ID**:

|モデル|✓|
|---|---|
|`deepseek-v4-flash-0731`|✓|

**新しいアカウントで得られるもの:** 最初の **デイリーチェックイン** 後（チェックインするとアカウントが
補充されます — 明日またチェックインすれば再び満タンになります）に計測される **5,595〜7,216 ユニット** の
無料クォータ。パネルのカタログ全体はもっと大きいですが、キーが呼び出せるのはそのグループが提供するもの
だけであり、このリポジトリのキーは `Free` に属しています。

**もっと増やすには:** クォータはアカウントに紐づきます — 1アカウントにつき1キーです。`--count N` を指定すると
N 個のアカウントを作成し、それぞれが独自のキー、独自のクォータ、独自のデイリーチェックインを持ちます。

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 9Router に接続する

このツールが作成するキーは通常の OpenAI 互換の資格情報なので、ローカルの
9Router インスタンスは他のプロバイダーと同様にそれらを扱えます。yjs.im 用の
`openai-compatible` ノードを1つ、キーごとに1つの接続を作ります。

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

ランチャーメニューと CLI ディスパッチャーは同じコネクタを操作します:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

デフォルト: base `http://localhost:20128`、password `123456`、モデルプレフィックス
`yjs`、node `yjs`、upstream `https://api.yjs.im/v1`、デフォルトモデル
`deepseek-v4-flash-0731`。作成した別のキーは `--name "<label 2>"` で登録します — ノードはそのまま残り、
各キーが 9Router で負荷分散できる別の接続になります。その後、9Router 内でモデルを選択してください:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI オプション

| タスク | フラグ |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — さらにエンジン自身のフラグ（`node src/mint.js --help`） |
| `launcher.js` | 対話式: mint / settings（件数、同時実行数） — `launcher.config.json` に保存 |

## 🛰️ プロキシの背後で

* `proxies.txt` — 1行につき1つの出口。`scheme://user:pass@host:port`、`scheme://host:port`、または
  素の `host:port`（デフォルトは `http://`）。`#` 以降のコメントと空行は無視されます。
* 出口は **使用する瞬間に** パネルに対して疎通確認されます。死んだものは除外され、プールは
  使用可能なものが尽きたときにのみ再読み込みされます。
* あなたのインターフェースの外には何も出ません: パネルへのすべてのリクエスト（およびメールボックスの
  通信）はプロキシプールを経由します。

## 🐞 問題報告

失敗したステップ、使用した出口、ツールの標準出力を添えて issue を作成してください —
`accounts.json` と `outputs/` にあるアカウントごとのダンプがあれば、キーを漏らすことなく
失敗を再現できます。

## 📄 ライセンス

MIT — [LICENSE](LICENSE) を参照してください。作成が許可されているアカウントでのみ使用してください。

---