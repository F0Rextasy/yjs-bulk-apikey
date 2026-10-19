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

**yjs.im-Konten im Batch mit automatisch generierten API-Schlüsseln erstellen – OpenAI-kompatible Inferenz + 9Router-Connector.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 Schnellstart](#-quick-start) · [✅ Verifiziert](#-verified-working--every-key-is-tested) · [🧭 So funktioniert es](#-how-it-works) · [🤖 Modelle & kostenloses Kontingent](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ Optionen](#️-cli-options) · [🛰️ Proxys](#️-behind-a-proxy) · [🐞 Probleme](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **Ein Konto, ein Schlüssel.** N Konten → N Schlüssel, eine Registrierung pro Konto, jeder Schlüssel live verifiziert
> bevor er in `keys.txt` landet.

## ✨ Was dieses Tool macht

Jasper (`api.yjs.im`) gibt jedem Konto ein kostenloses Kontingent – die nutzbare Einheit ist *ein Konto pro Schlüssel*,
denn das Kontingent hängt am **Konto**, niemals an einem zweiten Schlüssel desselben Kontos. Die Registrierung ist
offen, die E-Mail-Verifizierung ist live, und das Panel führt einen **täglichen Check-in** durch, der das Konto wieder auffüllt.
Dieses Tool durchläuft den gesamten Weg unbeaufsichtigt – frisches Postfach, Registrierung, Check-in, Schlüsselerstellung, Live-Verifizierung – über deine Proxy-Liste und hängt einen Schlüssel erst nach einer echten Completion an `keys.txt` an.

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

## 🛠 Schnellstart

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

Alles, was die Tools schreiben, landet **neben dem Code**: `src/keys.txt`, `src/accounts.json`,
`src/out/`. Der Pool wird aus `src/proxies.txt` gelesen.

`node src/cli.js help` listet die Aufgaben auf;
 jede Aufgabe hat ihre eigenen Flags – frage sie direkt ab
(`node src/mint.js --help`). Schlüssel landen in `keys.txt`, einer pro Zeile; Details pro Konto (E-Mail,
Schritte, Verifizierungsergebnis) landen in `accounts.json`. Einstellungen aus dem Launcher bleiben in
`launcher.config.json` erhalten.

## ✅ Verifiziert funktionsfähig – jeder Schlüssel wird getestet

Ein Schlüssel wird nur dann in `keys.txt` geschrieben, wenn die Live-API mit ihm antwortet:

| Prüfung | Aufruf | erwartet |
|---|---|---|
| Authentifizierung + Modellliste | `GET https://api.yjs.im/v1/models` | `200` + die Modell-IDs des Kontos (14 in der Gruppe `Free`) |
| echte Completion | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + die Assistenten-Nachricht |

Der Batch, mit dem dieses Repository ausgeliefert wurde: **3 verschiedene Konten → 3 Schlüssel, jeder einzelne verifiziert**
(`models` 200 + `deepseek-v4-flash-0731` Chat 200), jeder erneut geprüft von einem Exit, der sich von dem **unterscheidet**,
der ihn erzeugt hat.

## 🧭 So funktioniert es

Pro Konto, von Anfang bis Ende über einen Exit:

1. ein frischer Exit aus `proxies.txt`, der genau dann gegen das Panel geprüft wird (ein toter Exit kostet einen
   Versuch, nicht den gesamten Batch);
2. ein frisches Verifizierungspostfach pro Konto – diese Panels akzeptieren echte Postfach-Domains, daher
   registriert das Tool eines und liest den Code aus dem Nachrichtentext;
3. `GET /api/verification?email=…` → die Code-E-Mail → `POST /api/user/register`;
4. `POST /api/user/login` → Sitzung → `POST /api/user/checkin` (tägliche Kontingent-Auffüllung);
5. `POST /api/token/` → das Token wird **unbegrenzt** erstellt, und sein Klartext wird aus der Reveal-Route gelesen
   (die Erstellungsantwort ist maskiert);
6. die Gruppe des Tokens wird auf **`Free`** gesetzt – die Gruppe, die die 14 Modelle unten bereitstellt;
7. der Schlüssel wird erfasst und dann live verifiziert (`/v1/models` + eine Chat-Completion) und an
   `keys.txt` + `accounts.json` angehängt.

## 🤖 Modelle & kostenloses Kontingent

`models.json` ist die Live-Antwort von `GET /v1/models` eines erzeugten Schlüssels in der Gruppe `Free` – **14 IDs**:

|Modell|✓|
|---|---|
|`deepseek-v4-flash-0731`|✓|

**Was ein frisches Konto bekommt:** ein kostenloses Kontingent von **5.595–7.216 Einheiten** nach dem ersten
**täglichen Check-in** (der das Konto auffüllt – morgen erneut einchecken und es füllt sich wieder auf). Der vollständige
Katalog des Panels ist größer; was ein Schlüssel aufrufen kann, ist genau das, was seine Gruppe bereitstellt, und die
Schlüssel dieses Repositorys sind in `Free`.

**So bekommst du mehr:** Das Kontingent hängt am Konto – ein Konto pro Schlüssel. `--count N` erzeugt N
Konten, jedes mit eigenem Schlüssel, eigenem Kontingent und eigenem täglichen Check-in.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 Mit 9Router verbinden

Die Schlüssel, die dieses Tool erzeugt, sind gewöhnliche OpenAI-kompatible Zugangsdaten, daher kann eine lokale
9Router-Instanz sie wie jeden anderen Anbieter bereitstellen: ein `openai-compatible`-Node für yjs.im, eine Verbindung pro Schlüssel.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

Das Launcher-Menü und der CLI-Dispatcher steuern denselben Connector:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

Standardwerte: Basis `http://localhost:20128`, Passwort `123456`, Modellpräfix
`yjs`, Node `yjs`, Upstream `https://api.yjs.im/v1`, Standardmodell
`deepseek-v4-flash-0731`. Registriere einen weiteren erzeugten Schlüssel mit `--name "<label 2>"` – der Node bleibt bestehen und
jeder Schlüssel wird eine weitere Verbindung, über die 9Router Lastverteilung betreiben kann. Wähle dann ein Modell in
9Router aus:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI-Optionen

| Aufgabe | Flags |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) – plus die eigenen Flags der Engine (`node src/mint.js --help`) |
| `launcher.js` | interaktiv: Mint / Einstellungen (Anzahl, Parallelität) – gespeichert in `launcher.config.json` |

## 🛰️ Hinter einem Proxy

* `proxies.txt` – ein Exit pro Zeile; `scheme://user:pass@host:port`, `scheme://host:port` oder nur
  `host:port` (Standard ist `http://`). Kommentare nach `#` und Leerzeilen werden ignoriert.
* Exits werden im Moment der Nutzung gegen das Panel geprüft; tote werden ausgemustert, und der Pool
  wird erst neu eingelesen, wenn die nutzbaren Exits aufgebraucht sind.
* Nichts verlässt deine eigene Schnittstelle: jede Panel-Anfrage (und der Postfach-Verkehr) läuft über
  den Pool.

## 🐞 Probleme

Öffne ein Issue mit dem fehlschlagenden Schritt, dem verwendeten Exit und der stdout-Ausgabe des Tools – die Dumps pro Konto in
`accounts.json` und `outputs/` machen Fehler reproduzierbar, ohne einen Schlüssel preiszugeben.

## 📄 Lizenz

MIT – siehe [LICENSE](LICENSE). Verwende es für Konten, die du erstellen darfst.

---