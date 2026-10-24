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

**yjs.im 계정을 자동 생성된 API 키와 함께 대량 생성 — OpenAI 호환 추론 + 9Router 커넥터.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)
[![OmniRoute](https://img.shields.io/badge/OmniRoute-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-omniroute)

[🛠 빠른 시작](#-quick-start) · [✅ 검증됨](#-verified-working--every-key-is-tested) · [🧭 작동 방식](#-how-it-works) · [🤖 모델 및 무료 티어](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [🔌 OmniRoute](#-connect-to-omniroute) · [⚙️ 옵션](#️-cli-options) · [🛰️ 프록시](#️-behind-a-proxy) · [🐞 이슈](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **계정 하나, 키 하나.** N개 계정 → N개 키, 각각 한 번의 가입, 모든 키는 `keys.txt`에 들어가기 전에 실시간으로 검증됩니다.

## ✨ 이 도구가 하는 일

Jasper(`api.yjs.im`)는 모든 계정에 무료 할당량을 부여합니다 — 사용 가능한 단위는 *키당 계정 하나*입니다. 할당량은 **계정**에 존재하며, 같은 계정의 두 번째 키에는 절대 존재하지 않기 때문입니다. 가입은 열려 있고, 이메일 인증은 실시간이며, 패널은 계정을 충전하는 **일일 체크인**을 운영합니다. 이 도구는 프록시 목록을 통해 전체 경로 — 새 메일함, 가입, 체크인, 키 생성, 실시간 검증 — 를 무인으로 진행하고, 실제 완료 응답이 확인된 뒤에만 `keys.txt`에 키를 추가합니다.

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

## 🛠 빠른 시작

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

도구가 쓰는 모든 것은 **코드 옆**에 저장됩니다: `src/keys.txt`, `src/accounts.json`, `src/out/`. 프록시 풀은 `src/proxies.txt`에서 읽습니다.

`node src/cli.js help`는 작업 목록을 보여 줍니다; 각 작업은 자체 플래그를 받습니다 — 해당 작업에 직접 물어보세요 (`node src/mint.js --help`). 키는 한 줄에 하나씩 `keys.txt`에 저장되고, 계정별 세부 정보(이메일, 단계, 검증 결과)는 `accounts.json`에 저장됩니다. 런처의 설정은 `launcher.config.json`에 유지됩니다.

## ✅ 검증된 작동 — 모든 키가 테스트됩니다

키는 실제 API가 해당 키로 응답한 뒤에만 `keys.txt`에 기록됩니다:

| 검사 | 호출 | 예상 결과 |
|---|---|---|
| 인증 + 모델 목록 | `GET https://api.yjs.im/v1/models` | `200` + 해당 계정의 모델 ID (`Free` 그룹에서 14개) |
| 실제 완료 응답 | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + 어시스턴트 메시지 |

이 저장소가 배포된 기준 배치: **서로 다른 계정 3개 → 키 3개, 모두 검증됨** (`models` 200 + `deepseek-v4-flash-0731` 채팅 200), 각 키는 생성에 사용된 출구와 **다른** 출구에서 다시 확인되었습니다.

## 🧭 작동 방식

계정마다 하나의 출구를 통해 처음부터 끝까지:

1. `proxies.txt`에서 가져온 새 출구를 그 시점에 패널에 대해 검증합니다 (죽은 출구는 배치 전체가 아니라 시도 한 번만 소모합니다);
2. 계정마다 새 인증 메일함 — 이 패널들은 실제 메일함 도메인을 허용하므로, 도구가 메일함 하나를 등록하고 메시지 본문에서 코드를 읽습니다;
3. `GET /api/verification?email=…` → 인증 코드 메일 → `POST /api/user/register`;
4. `POST /api/user/login` → 세션 → `POST /api/user/checkin` (일일 할당량 충전);
5. `POST /api/token/` → 토큰은 **무제한**으로 생성되며, 평문은 공개 라우트에서 읽습니다 (생성 응답은 마스킹됩니다);
6. 토큰의 그룹은 아래 14개 모델을 제공하는 **`Free`** 그룹으로 설정됩니다;
7. 키를 캡처한 다음 실시간으로 검증하고 (`/v1/models` + 채팅 완료 응답) `keys.txt` + `accounts.json`에 추가합니다.

## 🤖 모델 및 무료 티어

`models.json`은 `Free` 그룹에서 발급된 키의 실제 `GET /v1/models` 응답입니다 — **14개 ID**:

|모델|✓|
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

2026-10-19 실시간 재확인: 프로브한 ID 16개 중 16개가 채팅 `200`으로 응답했습니다 (패널은 위의 대소문자 변형 중복을 별도 ID로 제공합니다).

**새 계정이 받는 것:** 첫 **일일 체크인** 후 측정된 무료 할당량 **5,595–7,216 단위**입니다 (체크인은 계정을 충전하며 — 내일 다시 체크인하면 다시 채워집니다). 패널의 전체 카탈로그는 더 큽니다. 키가 호출할 수 있는 것은 정확히 해당 그룹이 제공하는 것이며, 이 저장소의 키는 `Free`에 있습니다.

**더 얻는 방법:** 할당량은 계정에 있습니다 — 키당 계정 하나입니다. `--count N`은 N개 계정을 발급하며, 각 계정은 자체 키, 자체 할당량, 자체 일일 체크인을 가집니다.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 9Router에 연결

이 도구가 발급하는 키는 일반적인 OpenAI 호환 자격 증명이므로, 로컬 9Router 인스턴스가 다른 제공자와 마찬가지로 이를 서비스할 수 있습니다: yjs.im용 `openai-compatible` 노드 하나, 키당 연결 하나.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

런처 메뉴와 CLI 디스패처는 동일한 커넥터를 구동합니다:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

기본값: 베이스 `http://localhost:20128`, 비밀번호 `123456`, 모델 접두사 `yjs`, 노드 `yjs`, 업스트림 `https://api.yjs.im/v1`, 기본 모델 `deepseek-v4-flash-0731`. 발급된 다른 키를 `--name "<label 2>"`로 등록하세요 — 노드는 유지되고 모든 키는 9Router가 로드 밸런싱할 수 있는 또 다른 연결이 됩니다. 그런 다음 9Router 안에서 모델을 선택하세요:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## 🔌 OmniRoute에 연결

이 도구가 발급하는 키는 일반적인 OpenAI 호환 자격 증명이므로, 로컬 OmniRoute 인스턴스가 다른 제공자와 마찬가지로 이를 서비스할 수 있습니다: yjs.im용 `openai-compatible` 노드 하나, 키당 연결 하나.

```bash
node src/connect-omniroute.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

런처 메뉴와 CLI 디스패처는 동일한 커넥터를 구동합니다:

```bash
node src/launcher.js --connect-omniroute    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-omniroute.js --help        # every flag and default
```

기본값: 베이스 `http://localhost:20128`, 비밀번호 `123456`, 모델 접두사 `yjs`, 노드 `yjs`, 업스트림 `https://api.yjs.im/v1`, 기본 모델 `deepseek-v4-flash-0731`. 발급된 다른 키를 `--name "<label 2>"`로 등록하세요 — 노드는 유지되고 모든 키는 OmniRoute가 로드 밸런싱할 수 있는 또 다른 연결이 됩니다. 그런 다음 OmniRoute 안에서 모델을 선택하세요:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI 옵션

| 작업 | 플래그 |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — 엔진 자체 플래그도 포함 (`node src/mint.js --help`) |
| `launcher.js` | 대화형: 발급 / 설정 (개수, 동시성) — `launcher.config.json`에 유지됨 |

## 🛰️ 프록시 뒤에서

* `proxies.txt` — 한 줄에 출구 하나; `scheme://user:pass@host:port`, `scheme://host:port` 또는 스킴 없는 `host:port` (`http://`가 기본값). `#` 뒤의 주석과 빈 줄은 무시됩니다.
* 출구는 **사용하는 순간** 패널에 대해 검증됩니다; 죽은 출구는 폐기되며, 사용 가능한 집합이 바닥날 때만 풀을 다시 읽습니다.
* 어떤 것도 자체 인터페이스 밖으로 나가지 않습니다: 모든 패널 요청(및 메일함 트래픽)은 풀을 통해 나갑니다.

## 🐞 이슈

실패한 단계, 사용한 출구, 도구의 stdout을 포함해 이슈를 열어 주세요 — `accounts.json`과 `outputs/`의 계정별 덤프를 통해 키를 유출하지 않고 실패를 재현할 수 있습니다.

## 📄 라이선스

MIT — [LICENSE](LICENSE)를 참조하세요. 생성이 허용된 계정에만 사용하세요.

---