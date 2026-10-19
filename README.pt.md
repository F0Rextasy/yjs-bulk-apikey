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

**Crie contas yjs.im em massa com chaves de API geradas automaticamente — inferência compatível com OpenAI + conector 9Router.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 Início rápido](#-quick-start) · [✅ Verificado](#-verified-working--every-key-is-tested) · [🧭 Como funciona](#-how-it-works) · [🤖 Modelos e camada gratuita](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ Opções](#️-cli-options) · [🛰️ Proxies](#️-behind-a-proxy) · [🐞 Problemas](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **Uma conta, uma chave.** N contas → N chaves, um cadastro para cada, e cada chave é verificada ao vivo
> antes de chegar a `keys.txt`.

## ✨ O que isto faz

O Jasper (`api.yjs.im`) dá a toda conta uma cota gratuita — a unidade utilizável é *uma conta por chave*,
porque a cota fica na **conta**, nunca em uma segunda chave da mesma conta. O cadastro é
aberto, a verificação por e-mail é ao vivo, e o painel faz um **check-in diário** que recarrega a conta.
Esta ferramenta percorre todo o caminho sem supervisão — caixa de correio nova, cadastro, check-in, criação de chave, verificação
ao vivo — sobre a sua lista de proxies, e só acrescenta uma chave a `keys.txt` depois de um completion real.

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

## 🛠 Início rápido

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

Tudo o que as ferramentas gravam fica **ao lado do código**: `src/keys.txt`, `src/accounts.json`,
`src/out/`. O pool é lido de `src/proxies.txt`.

`node src/cli.js help` lista as tarefas;
 cada tarefa tem as suas próprias flags — pergunte diretamente a ela
(`node src/mint.js --help`). As chaves ficam em `keys.txt`, uma por linha; o detalhe por conta (e-mail,
etapas, resultado da verificação) fica em `accounts.json`. As configurações do launcher persistem em
`launcher.config.json`.

## ✅ Verificado e funcionando — cada chave é testada

Uma chave só é gravada em `keys.txt` depois que a API ao vivo responde com ela:

| verificação | chamada | esperado |
|---|---|---|
| auth + lista de modelos | `GET https://api.yjs.im/v1/models` | `200` + os ids de modelo da conta (14 no grupo `Free`) |
| completion real | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + a mensagem do assistente |

O lote de onde este repositório saiu: **3 contas distintas → 3 chaves, todas verificadas**
(`models` 200 + chat `deepseek-v4-flash-0731` 200), cada uma rechecada a partir de uma saída **diferente** da
que a gerou.

## 🧭 Como funciona

Por conta, de ponta a ponta através de uma saída:

1. uma saída nova de `proxies.txt`, comprovada contra o painel naquele momento (uma saída morta custa uma
   tentativa, não o lote);
2. uma caixa de correio de verificação nova por conta — esses painéis aceitam domínios de caixa reais, então a ferramenta
   registra uma e lê o código no corpo da mensagem;
3. `GET /api/verification?email=…` → o e-mail com o código → `POST /api/user/register`;
4. `POST /api/user/login` → sessão → `POST /api/user/checkin` (recarga da cota diária);
5. `POST /api/token/` → o token é criado **sem limite** e o seu texto simples é lido na rota de
   revelação (a resposta da criação vem mascarada);
6. o grupo do token é definido como **`Free`** — o grupo que serve os 14 modelos abaixo;
7. a chave é capturada, depois verificada ao vivo (`/v1/models` + um completion de chat) e acrescentada a
   `keys.txt` + `accounts.json`.

## 🤖 Modelos e camada gratuita

`models.json` é a resposta ao vivo de `GET /v1/models` de uma chave gerada no grupo `Free` — **14 ids**:

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

Rechecagem ao vivo de 2026-10-19: 16/16 ids testados responderam um chat `200` (o painel serve as variantes de maiúsculas/minúsculas acima como ids separados).

**O que uma conta nova recebe:** uma cota gratuita medida em **5.595–7.216 unidades** após o primeiro
**check-in diário** (que recarrega a conta — faça check-in de novo amanhã e ela enche outra vez). O catálogo
completo do painel é maior; o que uma chave pode chamar é exatamente o que o seu grupo serve, e as chaves deste repositório
estão em `Free`.

**Como obter mais:** a cota fica na conta — uma conta por chave. `--count N` gera N
contas, cada uma com a sua chave, a sua cota e o seu check-in diário.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 Conectar ao 9Router

As chaves que esta ferramenta gera são credenciais comuns compatíveis com OpenAI, então uma instância
local do 9Router pode servi-las como qualquer outro provedor: um nó `openai-compatible`
para o yjs.im, uma conexão por chave.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

O menu do launcher e o despachante da CLI acionam o mesmo conector:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

Padrões: base `http://localhost:20128`, senha `123456`, prefixo de modelo
`yjs`, nó `yjs`, upstream `https://api.yjs.im/v1`, modelo padrão
`deepseek-v4-flash-0731`. Registre outra chave gerada com `--name "<label 2>"` — o nó permanece e
cada chave se torna outra conexão sobre a qual o 9Router pode fazer balanceamento de carga. Depois escolha um modelo dentro
do 9Router:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ Opções da CLI

| tarefa | flags |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — mais as flags do próprio motor (`node src/mint.js --help`) |
| `launcher.js` | interativo: mint / configurações (quantidade, concorrência) — persistidas em `launcher.config.json` |

## 🛰️ Atrás de um proxy

* `proxies.txt` — uma saída por linha; `scheme://user:pass@host:port`, `scheme://host:port` ou
  `host:port` puro (o padrão é `http://`). Comentários após `#` e linhas em branco são ignorados.
* As saídas são comprovadas contra o painel **no momento do uso**; as mortas são aposentadas e o pool
  só é relido quando o conjunto utilizável se esgota.
* Nada sai da sua própria interface: toda requisição ao painel (e o tráfego da caixa de correio) passa
  pelo pool.

## 🐞 Problemas

Abra uma issue com a etapa que falhou, a saída usada e o stdout da ferramenta — os despejos por conta em
`accounts.json` e `outputs/` tornam as falhas reproduzíveis sem vazar uma chave.

## 📄 Licença

MIT — consulte [LICENSE](LICENSE). Use em contas que você tem permissão para criar.

---