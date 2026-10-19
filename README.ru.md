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

**Массовое создание аккаунтов yjs.im с автоматически сгенерированными API-ключами — OpenAI-совместимый инференс + коннектор 9Router.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Зависимости](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![Лицензия](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Модели](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 Быстрый старт](#-quick-start) · [✅ Проверено](#-verified-working--every-key-is-tested) · [🧭 Как это работает](#-how-it-works) · [🤖 Модели и бесплатный тариф](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ Параметры](#️-cli-options) · [🛰️ Прокси](#️-behind-a-proxy) · [🐞 Проблемы](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **Один аккаунт — один ключ.** N аккаунтов → N ключей, по одной регистрации на каждый, каждый ключ проверяется вживую, прежде чем попасть в `keys.txt`.

## ✨ Что это делает

Jasper (`api.yjs.im`) выдаёт каждому аккаунту бесплатную квоту — используемая единица — *один аккаунт на ключ*, потому что квота живёт на **аккаунте**, а не на втором ключе того же аккаунта. Регистрация открыта, проверка e-mail работает, а панель выполняет **ежедневную отметку** (check-in), которая пополняет аккаунт. Этот инструмент проходит весь путь без участия человека — новый почтовый ящик, регистрация, check-in, создание ключа, живая проверка — по вашему списку прокси и добавляет ключ в `keys.txt` только после реального выполнения запроса.

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

## 🛠 Быстрый старт

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

Всё, что записывают инструменты, попадает **рядом с кодом**: `src/keys.txt`, `src/accounts.json`,
`src/out/`. Пул читается из `src/proxies.txt`.

`node src/cli.js help` перечисляет задачи;
каждая задача принимает собственные флаги — спросите напрямую
(`node src/mint.js --help`). Ключи попадают в `keys.txt`, по одному на строку; детали по каждому аккаунту (e-mail,
шаги, результат проверки) — в `accounts.json`. Настройки из лаунчера сохраняются в
`launcher.config.json`.

## ✅ Проверено в работе — каждый ключ протестирован

Ключ записывается в `keys.txt` только после того, как живой API отвечает с ним:

| проверка | вызов | ожидается |
|---|---|---|
| аутентификация + список моделей | `GET https://api.yjs.im/v1/models` | `200` + идентификаторы моделей аккаунта (14 в группе `Free`) |
| реальное выполнение запроса | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + сообщение ассистента |

Партия, с которой выпущен этот репозиторий: **3 разных аккаунта → 3 ключа, каждый проверен**
(`models` 200 + `deepseek-v4-flash-0731` chat 200), каждый повторно проверен через выход, **отличный** от
того, который создал ключ.

## 🧭 Как это работает

Для каждого аккаунта, от начала до конца через один выход:

1. новый выход из `proxies.txt`, проверенный на панели прямо тогда (мёртвый выход стоит одной
   попытки, а не всей партии);
2. новый ящик для верификации на каждый аккаунт — эти панели принимают реальные домены почты, поэтому инструмент
   регистрирует ящик и читает код из тела сообщения;
3. `GET /api/verification?email=…` → письмо с кодом → `POST /api/user/register`;
4. `POST /api/user/login` → сессия → `POST /api/user/checkin` (пополнение дневной квоты);
5. `POST /api/token/` → токен создаётся **без ограничений**, а его открытый текст читается из маршрута
   раскрытия (ответ создания замаскирован);
6. группа токена устанавливается в **`Free`** — группа, которая обслуживает 14 моделей ниже;
7. ключ сохраняется, затем проверяется вживую (`/v1/models` + chat completion) и добавляется в
   `keys.txt` + `accounts.json`.

## 🤖 Модели и бесплатный тариф

`models.json` — это живой ответ `GET /v1/models` созданного ключа в группе `Free` — **14 идентификаторов**:

|Модель|✓|
|---|---|
|`deepseek-v4-flash-0731`|✓|

**Что получает новый аккаунт:** бесплатная квота в размере **5 595–7 216 единиц** после первого
**ежедневного check-in** (который пополняет аккаунт — отметьтесь снова завтра, и она восполнится). Полный
каталог панели больше; ключ может вызывать ровно то, что обслуживает его группа, а ключи из этого
репозитория находятся в `Free`.

**Как получить больше:** квота живёт на аккаунте — один аккаунт на ключ. `--count N` создаёт N
аккаунтов, каждый со своим ключом, своей квотой и своим ежедневным check-in.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 Подключение к 9Router

Ключи, которые создаёт этот инструмент, — обычные OpenAI-совместимые учётные данные, поэтому локальный
экземпляр 9Router может обслуживать их как любого другого провайдера: один узел `openai-compatible`
для yjs.im, одно подключение на ключ.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

Меню лаунчера и диспетчер CLI используют один и тот же коннектор:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

По умолчанию: base `http://localhost:20128`, пароль `123456`, префикс модели
`yjs`, узел `yjs`, upstream `https://api.yjs.im/v1`, модель по умолчанию
`deepseek-v4-flash-0731`. Зарегистрируйте ещё один созданный ключ с `--name "<label 2>"` — узел остаётся, и
каждый ключ становится ещё одним подключением, между которыми 9Router может балансировать нагрузку. Затем выберите модель внутри
9Router:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ Параметры CLI

| задача | параметры |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — плюс собственные параметры движка (`node src/mint.js --help`) |
| `launcher.js` | интерактивно: создание ключей / настройки (количество, параллельность) — сохраняются в `launcher.config.json` |

## 🛰️ Работа через прокси

* `proxies.txt` — один выход на строку; `scheme://user:pass@host:port`, `scheme://host:port` или просто
  `host:port` (по умолчанию `http://`). Комментарии после `#` и пустые строки игнорируются.
* Выходы проверяются на панели **в момент использования**; неработающие удаляются, а пул
  перечитывается только когда рабочий набор исчерпан.
* Ничего не выходит за пределы вашего интерфейса: каждый запрос к панели (и трафик почтового ящика) идёт через
  пул.

## 🐞 Проблемы

Откройте issue, указав сбойный шаг, использованный выход и stdout инструмента — дампы по аккаунтам в
`accounts.json` и `outputs/` позволяют воспроизвести сбои, не раскрывая ключ.

## 📄 Лицензия

MIT — см. [LICENSE](LICENSE). Используйте только на аккаунтах, которые вам разрешено создавать.

---