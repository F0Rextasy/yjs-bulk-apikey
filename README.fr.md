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

**Créez en masse des comptes yjs.im avec des clés API générées automatiquement — inférence compatible OpenAI + connecteur 9Router.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dépendances](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![Licence](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Modèles](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 Démarrage rapide](#-quick-start) · [✅ Vérifié](#-verified-working--every-key-is-tested) · [🧭 Fonctionnement](#-how-it-works) · [🤖 Modèles et offre gratuite](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ Options](#️-cli-options) · [🛰️ Proxys](#️-behind-a-proxy) · [🐞 Problèmes](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

---

> **Un compte, une clé.** N comptes → N clés, une inscription chacun, chaque clé vérifiée en direct
> avant d’atterrir dans `keys.txt`.

## ✨ Ce que fait cet outil

Jasper (`api.yjs.im`) attribue à chaque compte un quota gratuit — l’unité utilisable est *un compte par clé*,
car le quota réside sur le **compte**, jamais sur une seconde clé du même compte. L’inscription est
ouverte, la vérification par e-mail est active, et le panneau exécute un **check-in quotidien** qui recharge le compte.
Cet outil parcourt tout le chemin sans surveillance — boîte mail fraîche, inscription, check-in, création de clé, vérification
en direct — via votre liste de proxys, et n’ajoute une clé à `keys.txt` qu’après une complétion réelle.

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

## 🛠 Démarrage rapide

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

Tout ce que les outils écrivent atterrit **à côté du code** : `src/keys.txt`, `src/accounts.json`,
`src/out/`. Le pool est lu depuis `src/proxies.txt`.

`node src/cli.js help` liste les tâches ;
 chaque tâche prend ses propres options — demandez-lui directement
(`node src/mint.js --help`). Les clés atterrissent dans `keys.txt`, une par ligne ; le détail par compte (e-mail,
étapes, résultat de vérification) atterrit dans `accounts.json`. Les réglages du lanceur persistent dans
`launcher.config.json`.

## ✅ Vérifié et fonctionnel — chaque clé est testée

Une clé n’est écrite dans `keys.txt` qu’après que l’API en direct a répondu avec elle :

| vérification | appel | attendu |
|---|---|---|
| authentification + liste des modèles | `GET https://api.yjs.im/v1/models` | `200` + les identifiants de modèles du compte (14 sur le groupe `Free`) |
| complétion réelle | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + le message de l’assistant |

Le lot avec lequel ce dépôt a été publié : **3 comptes distincts → 3 clés, toutes vérifiées**
(`models` 200 + chat `deepseek-v4-flash-0731` 200), chacune revérifiée depuis une sortie **différente** de
celle qui l’a générée.

## 🧭 Fonctionnement

Par compte, de bout en bout via une seule sortie :

1. une sortie fraîche depuis `proxies.txt`, validée auprès du panneau à cet instant (une sortie morte coûte une
   tentative, pas le lot) ;
2. une boîte mail de vérification fraîche par compte — ces panneaux acceptent de vrais domaines de boîte mail, donc l’outil
   en enregistre une et lit le code dans le corps du message ;
3. `GET /api/verification?email=…` → le mail contenant le code → `POST /api/user/register` ;
4. `POST /api/user/login` → session → `POST /api/user/checkin` (recharge du quota quotidien) ;
5. `POST /api/token/` → le jeton est créé **sans limite** et son texte en clair est lu depuis la route
   de révélation (la réponse de création est masquée) ;
6. le groupe du jeton est défini sur **`Free`** — le groupe qui sert les 14 modèles ci-dessous ;
7. la clé est capturée, puis vérifiée en direct (`/v1/models` + une complétion de chat) et ajoutée à
   `keys.txt` + `accounts.json`.

## 🤖 Modèles et offre gratuite

`models.json` est la réponse en direct de `GET /v1/models` d’une clé générée sur le groupe `Free` — **14 identifiants** :

|Modèle|✓|
|---|---|
|`deepseek-v4-flash-0731`|✓|

**Ce qu’obtient un nouveau compte :** un quota gratuit mesuré à **5 595–7 216 unités** après le premier
**check-in quotidien** (qui recharge le compte — refaites un check-in demain et il se remplit à nouveau). Le catalogue complet
du panneau est plus vaste ; ce qu’une clé peut appeler correspond exactement à ce que sert son groupe, et les clés de ce dépôt
sont sur `Free`.

**Comment en obtenir plus :** le quota réside sur le compte — un compte par clé. `--count N` génère N
comptes, chacun avec sa propre clé, son propre quota et son propre check-in quotidien.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 Se connecter à 9Router

Les clés que cet outil génère sont des identifiants ordinaires compatibles OpenAI, donc une instance locale
de 9Router peut les servir comme n’importe quel autre fournisseur : un nœud `openai-compatible`
pour yjs.im, une connexion par clé.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

Le menu du lanceur et le répartiteur CLI pilotent le même connecteur :

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

Valeurs par défaut : base `http://localhost:20128`, mot de passe `123456`, préfixe de modèle
`yjs`, nœud `yjs`, amont `https://api.yjs.im/v1`, modèle par défaut
`deepseek-v4-flash-0731`. Enregistrez une autre clé générée avec `--name "<label 2>"` — le nœud reste et
chaque clé devient une connexion supplémentaire sur laquelle 9Router peut répartir la charge. Choisissez ensuite un modèle dans
9Router :

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ Options CLI

| tâche | options |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — plus les options propres au moteur (`node src/mint.js --help`) |
| `launcher.js` | interactif : mint / réglages (nombre, concurrence) — persistés dans `launcher.config.json` |

## 🛰️ Derrière un proxy

* `proxies.txt` — une sortie par ligne ; `scheme://user:pass@host:port`, `scheme://host:port` ou `host:port` nu
  (par défaut `http://`). Les commentaires après `#` et les lignes vides sont ignorés.
* Les sorties sont validées auprès du panneau **au moment de l’utilisation** ; les sorties mortes sont retirées et le pool
  n’est relu que lorsque l’ensemble utilisable est épuisé.
* Rien ne quitte votre propre interface : chaque requête au panneau (et le trafic de la boîte mail) passe par
  le pool.

## 🐞 Problèmes

Ouvrez un ticket avec l’étape en échec, la sortie utilisée et la sortie standard de l’outil — les vidages par compte dans
`accounts.json` et `outputs/` rendent les échecs reproductibles sans divulguer de clé.

## 📄 Licence

MIT — voir [LICENSE](LICENSE). Utilisez-le sur des comptes que vous êtes autorisé à créer.

---