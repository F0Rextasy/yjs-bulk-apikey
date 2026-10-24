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

**Crea cuentas de yjs.im en masa con claves API autogeneradas — inferencia compatible con OpenAI + conector 9Router.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)
[![OmniRoute](https://img.shields.io/badge/OmniRoute-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-omniroute)

[🛠 Inicio rápido](#-quick-start) · [✅ Verificado](#-verified-working--every-key-is-tested) · [🧭 Cómo funciona](#-how-it-works) · [🤖 Modelos y nivel gratuito](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [🔌 OmniRoute](#-connect-to-omniroute) · [⚙️ Opciones](#️-cli-options) · [🛰️ Proxies](#️-behind-a-proxy) · [🐞 Problemas](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **Una cuenta, una clave.** N cuentas → N claves, un registro para cada una, cada clave verificada en vivo
> antes de aterrizar en `keys.txt`.

## ✨ Qué hace esto

Jasper (`api.yjs.im`) asigna a cada cuenta una cuota gratuita — la unidad utilizable es *una cuenta por clave*,
porque la cuota vive en la **cuenta**, nunca en una segunda clave de la misma cuenta. El registro está
abierto, la verificación por correo electrónico está activa, y el panel ejecuta un **check-in diario** que
recarga la cuenta. Esta herramienta recorre todo el camino sin intervención — buzón nuevo, registro, check-in,
creación de la clave, verificación en vivo — sobre tu lista de proxies, y añade una clave a `keys.txt` solo
después de una completion real.

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

## 🛠 Inicio rápido

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

Todo lo que escriben las herramientas queda **junto al código**: `src/keys.txt`, `src/accounts.json`,
`src/out/`. El pool se lee desde `src/proxies.txt`.

`node src/cli.js help` lista las tareas;
 cada tarea acepta sus propias flags — pregúntale directamente
(`node src/mint.js --help`). Las claves quedan en `keys.txt`, una por línea; el detalle por cuenta (correo,
pasos, resultado de la verificación) queda en `accounts.json`. Los ajustes del launcher persisten en
`launcher.config.json`.

## ✅ Verificado y funcionando — cada clave se prueba

Una clave se escribe en `keys.txt` solo cuando la API en vivo responde con ella:

| comprobación | llamada | esperado |
|---|---|---|
| autenticación + lista de modelos | `GET https://api.yjs.im/v1/models` | `200` + los ids de modelos de la cuenta (14 en el grupo `Free`) |
| completion real | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + el mensaje del asistente |

El lote con el que se publicó este repositorio: **3 cuentas distintas → 3 claves, todas verificadas**
(`models` 200 + chat `deepseek-v4-flash-0731` 200), cada una re-comprobada desde una salida **distinta**
de la que la generó.

## 🧭 Cómo funciona

Por cuenta, de principio a fin sobre una salida:

1. una salida nueva de `proxies.txt`, probada contra el panel en ese mismo momento (una salida muerta cuesta
   un intento, no el lote);
2. un buzón de verificación nuevo por cuenta — estos paneles aceptan dominios de buzón reales, así que la herramienta
   registra uno y lee el código del cuerpo del mensaje;
3. `GET /api/verification?email=…` → el correo con el código → `POST /api/user/register`;
4. `POST /api/user/login` → sesión → `POST /api/user/checkin` (recarga de la cuota diaria);
5. `POST /api/token/` → el token se crea **ilimitado** y su texto plano se lee desde la ruta de revelado
   (la respuesta de creación viene enmascarada);
6. el grupo del token se establece en **`Free`** — el grupo que sirve los 14 modelos de abajo;
7. la clave se captura, luego se verifica en vivo (`/v1/models` + una completion de chat) y se añade a
   `keys.txt` + `accounts.json`.

## 🤖 Modelos y nivel gratuito

`models.json` es la respuesta en vivo de `GET /v1/models` de una clave generada en el grupo `Free` — **14 ids**:

|Modelo|✓|
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

Re-comprobación en vivo del 2026-10-19: 16/16 ids probados respondieron un chat `200` (el panel sirve las variantes duplicadas de mayúsculas/minúsculas de arriba como ids separados).

**Qué obtiene una cuenta nueva:** una cuota gratuita medida en **5.595–7.216 unidades** tras el primer
**check-in diario** (que recarga la cuenta — vuelve a hacer check-in mañana y se rellena). El catálogo
completo del panel es mayor; lo que una clave puede llamar es exactamente lo que sirve su grupo, y las claves
de este repositorio están en `Free`.

**Cómo obtener más:** la cuota vive en la cuenta — una cuenta por clave. `--count N` genera N
cuentas, cada una con su propia clave, su propia cuota y su propio check-in diario.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 Conectar con 9Router

Las claves que genera esta herramienta son credenciales normales compatibles con OpenAI, así que una instancia
local de 9Router puede servirlas como cualquier otro proveedor: un nodo `openai-compatible`
para yjs.im, una conexión por clave.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

El menú del launcher y el despachador de la CLI manejan el mismo conector:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

Valores por defecto: base `http://localhost:20128`, contraseña `123456`, prefijo de modelo
`yjs`, nodo `yjs`, upstream `https://api.yjs.im/v1`, modelo por defecto
`deepseek-v4-flash-0731`. Registra otra clave generada con `--name "<label 2>"` — el nodo se mantiene y
cada clave se convierte en otra conexión sobre la que 9Router puede balancear la carga. Luego elige un modelo
dentro de 9Router:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## 🔌 Conectar con OmniRoute

Las claves que genera esta herramienta son credenciales normales compatibles con OpenAI, así que una instancia
local de OmniRoute puede servirlas como cualquier otro proveedor: un nodo `openai-compatible`
para yjs.im, una conexión por clave.

```bash
node src/connect-omniroute.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

El menú del launcher y el despachador de la CLI manejan el mismo conector:

```bash
node src/launcher.js --connect-omniroute    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-omniroute.js --help        # every flag and default
```

Valores por defecto: base `http://localhost:20128`, contraseña `123456`, prefijo de modelo
`yjs`, nodo `yjs`, upstream `https://api.yjs.im/v1`, modelo por defecto
`deepseek-v4-flash-0731`. Registra otra clave generada con `--name "<label 2>"` — el nodo se mantiene y
cada clave se convierte en otra conexión sobre la que OmniRoute puede balancear la carga. Luego elige un modelo
dentro de OmniRoute:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ Opciones de la CLI

| tarea | flags |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — más las flags propias del motor (`node src/mint.js --help`) |
| `launcher.js` | interactivo: mint / ajustes (count, concurrencia) — persistidos en `launcher.config.json` |

## 🛰️ Detrás de un proxy

* `proxies.txt` — una salida por línea; `scheme://user:pass@host:port`, `scheme://host:port` o `host:port`
  sin esquema (por defecto `http://`). Los comentarios tras `#` y las líneas en blanco se ignoran.
* Las salidas se prueban contra el panel **en el momento de uso**; las muertas se retiran y el pool
  solo se vuelve a leer cuando el conjunto utilizable se agota.
* Nada sale de tu propia interfaz: cada petición al panel (y el tráfico del buzón) pasa por
  el pool.

## 🐞 Problemas

Abre un issue con el paso que falla, la salida utilizada y el stdout de la herramienta — los volcados por cuenta en
`accounts.json` y `outputs/` hacen que los fallos sean reproducibles sin filtrar una clave.

## 📄 Licencia

MIT — consulta [LICENSE](LICENSE). Úsalo en cuentas que tengas permitido crear.

---