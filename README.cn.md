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

**批量创建带自动生成 API 密钥的 yjs.im 账户——兼容 OpenAI 的推理 + 9Router 连接器。**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![依赖项](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![许可证](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![模型](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 快速开始](#-quick-start) · [✅ 已验证](#-verified-working--every-key-is-tested) · [🧭 工作原理](#-how-it-works) · [🤖 模型与免费额度](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ CLI 选项](#️-cli-options) · [🛰️ 代理环境下](#️-behind-a-proxy) · [🐞 问题](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **一个账户，一个密钥。** N 个账户 → N 个密钥，每个账户注册一次，每个密钥在写入 `keys.txt` 前都会实时验证。

## ✨ 功能简介

Jasper（`api.yjs.im`）会为每个账户发放免费额度——可用单位是*每个密钥对应一个账户*，因为额度存在于**账户**上，而绝不会存在于同一账户的第二个密钥上。注册开放，邮箱验证实时进行，面板会执行**每日签到**来为账户补充额度。此工具可无人值守地走完整条流程——全新邮箱、注册、签到、创建密钥、实时验证——通过你的代理列表完成，并且只有在真实补全成功后才会将密钥追加到 `keys.txt`。

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

`node src/cli.js help` 会列出任务；每个任务都有自己的参数——直接向它查询（`node src/mint.js --help`）。密钥会写入 `keys.txt`，每行一个；每个账户的详细信息（电子邮箱、步骤、验证结果）会写入 `accounts.json`。启动器中的设置会持久保存在 `launcher.config.json` 中。

## ✅ 已验证可用——每个密钥都经过测试

只有当实时 API 使用某个密钥成功响应后，该密钥才会被写入 `keys.txt`：

| 检查 | 调用 | 预期 |
|---|---|---|
| 认证 + 模型列表 | `GET https://api.yjs.im/v1/models` | `200` + 该账户的模型 ID（`Free` 组中为 14 个） |
| 真实补全 | `POST https://api.yjs.im/v1/chat/completions`（`deepseek-v4-flash-0731`） | `200` + 助手消息 |

本仓库发布时所用的批次：**3 个不同账户 → 3 个密钥，每一个都已验证**（`models` 200 + `deepseek-v4-flash-0731` 对话 200），每个密钥都从与生成它时**不同**的出口重新检查。

## 🧭 工作原理

每个账户都通过一个出口端到端完成：

1. 从 `proxies.txt` 获取一个新出口，并当场针对面板进行验证（失效出口只会消耗一次尝试，而不是整批）；
2. 为每个账户使用一个全新的验证邮箱——这些面板接受真实邮箱域名，因此工具会注册一个邮箱并从邮件正文中读取验证码；
3. `GET /api/verification?email=…` → 验证码邮件 → `POST /api/user/register`；
4. `POST /api/user/login` → 会话 → `POST /api/user/checkin`（每日额度补充）；
5. `POST /api/token/` → 令牌会以**无限制**方式创建，其明文会从 reveal 路由读取（创建响应是脱敏的）；
6. 将令牌的分组设置为 **`Free`**——即提供以下 14 个模型的分组；
7. 捕获密钥，然后进行实时验证（`/v1/models` + 一次对话补全），并追加到 `keys.txt` + `accounts.json`。

## 🤖 模型与免费额度

`models.json` 是 `Free` 组中某个已生成密钥的实时 `GET /v1/models` 响应——**14 个 ID**：

|模型|✓|
|---|---|
|`deepseek-v4-flash-0731`|✓|

**新账户可获得什么：**首次**每日签到**后，免费额度实测为 **5,595–7,216 单位**（签到会为账户补充额度——明天再次签到即可重新填充）。面板的完整目录更大；密钥能调用的内容恰好是其分组所提供的内容，而本仓库的密钥位于 `Free` 组。

**如何获取更多：**额度存在于账户上——每个密钥对应一个账户。`--count N` 会生成 N 个账户，每个账户都有自己的密钥、自己的额度和自己的每日签到。

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 连接到 9Router

此工具生成的密钥是普通的 OpenAI 兼容凭据，因此本地 9Router 实例可以像任何其他提供商一样使用它们：为 yjs.im 配置一个 `openai-compatible` 节点，每个密钥一个连接。

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

默认值：base 为 `http://localhost:20128`，password 为 `123456`，模型前缀为 `yjs`，节点为 `yjs`，上游为 `https://api.yjs.im/v1`，默认模型为 `deepseek-v4-flash-0731`。使用 `--name "<label 2>"` 注册另一个已生成的密钥——节点保持不变，而每个密钥都会成为 9Router 可进行负载均衡的另一个连接。然后在 9Router 中选择一个模型：

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI 选项

| 任务 | 参数 |
|---|---|
| `mint` | `--count N`（30）· `--conc N`（2）——以及引擎自身的参数（`node src/mint.js --help`） |
| `launcher.js` | 交互式：生成 / 设置（数量、并发）——持久保存在 `launcher.config.json` 中 |

## 🛰️ 代理环境下

* `proxies.txt` —— 每行一个出口；`scheme://user:pass@host:port`、`scheme://host:port` 或裸 `host:port`（默认为 `http://`）。`#` 之后的注释和空行会被忽略。
* 出口会在**使用时**针对面板进行验证；失效出口会被淘汰，只有可用集合耗尽时才会重新读取代理池。
* 不会从你自己的接口直接发出任何内容：每个面板请求（以及邮箱流量）都会经过代理池。

## 🐞 问题

提交 issue 时请附上失败的步骤、使用的出口以及工具的标准输出——`accounts.json` 和 `outputs/` 中按账户保存的转储内容可让故障可复现，同时不会泄露密钥。

## 📄 许可证

MIT —— 参见 [LICENSE](LICENSE)。请仅在你被允许创建的账户上使用它。

---