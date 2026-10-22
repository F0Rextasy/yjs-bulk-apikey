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

**批量创建 yjs.im 账户并自动生成 API 密钥——兼容 OpenAI 的推理 + 9Router 连接器。**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 快速开始](#-quick-start) · [✅ 已验证](#-verified-working--every-key-is-tested) · [🧭 工作原理](#-how-it-works) · [🤖 模型与免费额度](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ 选项](#️-cli-options) · [🛰️ 代理](#️-behind-a-proxy) · [🐞 问题](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **一个账户，一个密钥。** N 个账户 → N 个密钥，每个账户注册一次，每个密钥都会在写入 `keys.txt` 前经过实时验证。

## ✨ 这个工具做什么

Jasper（`api.yjs.im`）会为每个账户发放免费额度——可用单位是*一个账户对应一个密钥*，因为额度存在于**账户**上，而不是同一账户的第二个密钥上。注册开放，邮箱验证实时进行，面板会执行**每日签到**为账户补充额度。这个工具会无人值守地走完整个流程——全新邮箱、注册、签到、创建密钥、实时验证——并通过你的代理列表执行，只有在真实补全请求成功后才会将密钥追加到 `keys.txt`。

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

## 🛠 快速开始

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

工具写入的所有内容都会落在**代码旁边**：`src/keys.txt`、`src/accounts.json`、`src/out/`。代理池从 `src/proxies.txt` 读取。

`node src/cli.js help` 会列出任务；每个任务都有自己的参数——可以直接询问它（`node src/mint.js --help`）。密钥会写入 `keys.txt`，每行一个；每个账户的详细信息（邮箱、步骤、验证结果）会写入 `accounts.json`。启动器中的设置会持久化到 `launcher.config.json`。

## ✅ 已验证可用——每个密钥都经过测试

只有实时 API 使用某个密钥成功响应后，该密钥才会写入 `keys.txt`：

| 检查 | 调用 | 预期 |
|---|---|---|
| 认证 + 模型列表 | `GET https://api.yjs.im/v1/models` | `200` + 账户的模型 ID（`Free` 组中有 14 个） |
| 真实补全 | `POST https://api.yjs.im/v1/chat/completions`（`deepseek-v4-flash-0731`） | `200` + 助手消息 |

本仓库发布时所使用的批次：**3 个不同账户 → 3 个密钥，全部验证通过**（`models` 200 + `deepseek-v4-flash-0731` 聊天 200），每个密钥都从与创建它时**不同**的出口重新检查过。

## 🧭 工作原理

每个账户都通过一个出口端到端执行：

1. 从 `proxies.txt` 中取出一个全新出口，并在当时对面板进行验证（失效出口只会消耗一次尝试，而不是整批）；
2. 每个账户使用一个全新的验证邮箱——这些面板接受真实邮箱域名，因此工具会注册一个邮箱并从邮件正文读取验证码；
3. `GET /api/verification?email=…` → 验证码邮件 → `POST /api/user/register`；
4. `POST /api/user/login` → 会话 → `POST /api/user/checkin`（每日额度补充）；
5. `POST /api/token/` → 令牌会以**无限制**方式创建，并从 reveal 路由读取其明文（创建接口的响应是掩码的）；
6. 将令牌的分组设置为 **`Free`**——即提供下方 14 个模型的分组；
7. 捕获密钥，然后实时验证（`/v1/models` + 一次聊天补全），并追加到 `keys.txt` + `accounts.json`。

## 🤖 模型与免费额度

`models.json` 是 `Free` 组中一个已创建密钥的实时 `GET /v1/models` 响应——**14 个 ID**：

|模型|✓|
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

2026-10-19 实时复查：探测的 16/16 个 ID 都返回聊天 `200`（面板会将上方大小写变体重复项作为独立 ID 提供）。

**新账户会获得什么：** 首次**每日签到**后测得免费额度为 **5,595–7,216 单位**（签到会为账户补充额度——明天再次签到会继续补充）。面板的完整目录更大；密钥能调用的内容恰好是其所在分组提供的内容，而本仓库的密钥位于 `Free` 组。

**如何获得更多：** 额度存在于账户上——一个账户对应一个密钥。`--count N` 会创建 N 个账户，每个账户都有自己的密钥、自己的额度以及自己的每日签到。

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 连接到 9Router

此工具创建的密钥是普通的 OpenAI 兼容凭据，因此本地 9Router 实例可以像处理其他任何提供商一样使用它们：为 yjs.im 配置一个 `openai-compatible` 节点，每个密钥一个连接。

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

启动器菜单和 CLI 调度器驱动同一个连接器：

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

默认值：base 为 `http://localhost:20128`，password 为 `123456`，模型前缀为 `yjs`，节点为 `yjs`，上游为 `https://api.yjs.im/v1`，默认模型为 `deepseek-v4-flash-0731`。使用 `--name "<label 2>"` 注册另一个已创建的密钥——节点保持不变，每个密钥都会成为 9Router 可以进行负载均衡的另一个连接。然后在 9Router 中选择一个模型：

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI 选项

| 任务 | 参数 |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2)——外加引擎自身的参数（`node src/mint.js --help`） |
| `launcher.js` | 交互式：创建 / 设置（数量、并发）——持久化到 `launcher.config.json` |

## 🛰️ 在代理后面

* `proxies.txt` —— 每行一个出口；`scheme://user:pass@host:port`、`scheme://host:port` 或裸
  `host:port`（默认为 `http://`）。`#` 之后的注释和空行会被忽略。
* 出口会在**使用时**对面板进行验证；失效出口会被淘汰，只有可用集合耗尽时才会重新读取代理池。
* 不会有任何流量绕过你自己的网络接口：每个面板请求（以及邮箱流量）都会经过代理池。

## 🐞 问题

提交 issue 时请附上失败步骤、使用的出口以及工具的标准输出——`accounts.json` 和 `outputs/` 中按账户保存的转储可以让故障可复现，而不会泄露密钥。

## 📄 许可证

MIT —— 参见 [LICENSE](LICENSE)。请仅用于你被允许创建的账户。

---