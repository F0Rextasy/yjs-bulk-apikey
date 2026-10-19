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

**Otomatik oluşturulan API anahtarlarıyla yjs.im hesaplarını toplu oluşturun — OpenAI uyumlu çıkarım + 9Router bağlayıcısı.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-14%20free-412991?style=for-the-badge)](src/models.json)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6.svg?style=for-the-badge)](#-connect-to-9router)

[🛠 Hızlı başlangıç](#-quick-start) · [✅ Doğrulanmış](#-verified-working--every-key-is-tested) · [🧭 Nasıl çalışır](#-how-it-works) · [🤖 Modeller ve ücretsiz katman](#-models--free-tier) · [🔌 9Router](#-connect-to-9router) · [⚙️ Seçenekler](#️-cli-options) · [🛰️ Proxy'ler](#️-behind-a-proxy) · [🐞 Sorunlar](#-issues)

</div>

<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>


---

> **Bir hesap, bir anahtar.** N hesap → N anahtar, her biri için bir kayıt, her anahtar `keys.txt` dosyasına yazılmadan önce canlı doğrulanır.

## ✨ Bu ne yapar

Jasper (`api.yjs.im`) her hesaba ücretsiz bir kota verir — kullanılabilir birim, anahtar başına bir hesaptır; çünkü kota hesapta bulunur, aynı hesabın ikinci bir anahtarında asla. Kayıt açıktır, e-posta doğrulaması canlıdır ve panel hesabı takviye eden günlük bir check-in çalıştırır. Bu araç tüm yolu denetimsiz kat eder — taze posta kutusu, kayıt, check-in, anahtar oluşturma, canlı doğrulama — proxy listeniz üzerinden ve bir anahtarı `keys.txt` dosyasına ancak gerçek bir tamamlamadan sonra ekler.

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

## 🛠 Hızlı başlangıç

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

Araçların yazdığı her şey **kodun yanına** düşer: `src/keys.txt`, `src/accounts.json`,
`src/out/`. Havuz `src/proxies.txt` dosyasından okunur.

`node src/cli.js help` görevleri listeler;
 her görev kendi bayraklarını alır — doğrudan ona sorun
(`node src/mint.js --help`). Anahtarlar `keys.txt` dosyasına her satırda bir tane olacak şekilde düşer; hesap başına ayrıntı (e-posta,
adımlar, doğrulama sonucu) `accounts.json` dosyasına düşer. Başlatıcıdaki ayarlar
`launcher.config.json` içinde kalıcı olur.

## ✅ Doğrulanmış çalışıyor — her anahtar test edilir

Bir anahtar `keys.txt` dosyasına ancak canlı API onunla yanıt verdikten sonra yazılır:

| kontrol | çağrı | beklenen |
|---|---|---|
| kimlik doğrulama + model listesi | `GET https://api.yjs.im/v1/models` | `200` + hesabın model kimlikleri (`Free` grubunda 14) |
| gerçek tamamlama | `POST https://api.yjs.im/v1/chat/completions` (`deepseek-v4-flash-0731`) | `200` + asistan mesajı |

Bu deponun gönderildiği parti: **3 farklı hesap → 3 anahtar, her biri doğrulandı**
(`models` 200 + `deepseek-v4-flash-0731` sohbet 200), her biri onu üreten çıkıştan **farklı**
bir çıkıştan yeniden kontrol edildi.

## 🧭 Nasıl çalışır

Hesap başına, tek bir çıkış üzerinden uçtan uca:

1. `proxies.txt` dosyasından taze bir çıkış; tam o anda panele karşı doğrulanır (ölü bir çıkış bir
   denemeye mal olur, partiye değil);
2. her hesap için taze bir doğrulama posta kutusu — bu paneller gerçek posta kutusu alan adlarını kabul eder, bu yüzden araç
   bir tane kaydeder ve kodu mesaj gövdesinden okur;
3. `GET /api/verification?email=…` → kod e-postası → `POST /api/user/register`;
4. `POST /api/user/login` → oturum → `POST /api/user/checkin` (günlük kota takviyesi);
5. `POST /api/token/` → belirteç **sınırsız** oluşturulur ve düz metni reveal rotasından okunur
   (oluşturma yanıtı maskelenir);
6. belirtecin grubu **`Free`** olarak ayarlanır — aşağıdaki 14 modeli sunan grup;
7. anahtar yakalanır, ardından canlı doğrulanır (`/v1/models` + bir sohbet tamamlama) ve
   `keys.txt` + `accounts.json` dosyalarına eklenir.

## 🤖 Modeller ve ücretsiz katman

`models.json`, `Free` grubundaki oluşturulmuş bir anahtarın canlı `GET /v1/models` yanıtıdır — **14 kimlik**:

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

2026-10-19 canlı yeniden kontrol: sorgulanan 16/16 kimlik bir sohbete `200` yanıtı verdi (panel yukarıdaki büyük/küçük harf varyantı kopyaları ayrı kimlikler olarak sunar).

**Yeni bir hesabın aldığı:** ilk **günlük check-in** sonrasında **5,595–7,216 birim** olarak ölçülen ücretsiz bir kota (bu, hesabı takviye eder — yarın tekrar check-in yapın ve yeniden dolar). Panelin
tam kataloğu daha büyüktür; bir anahtarın çağırabileceği şey tam olarak grubunun sunduğudur ve bu deponun
anahtarları `Free` üzerindedir.

**Daha fazlası nasıl alınır:** kota hesapta bulunur — anahtar başına bir hesap. `--count N`, her biri kendi anahtarına, kendi kotasına ve kendi günlük check-in'ine sahip N hesap oluşturur.

```bash
curl https://api.yjs.im/v1/chat/completions \
  -H "Authorization: Bearer <one of your keys>" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}]}'
```

## 🔌 9Router'a bağlan

Bu aracın oluşturduğu anahtarlar sıradan OpenAI uyumlu kimlik bilgileridir, bu yüzden yerel bir
9Router örneği bunları başka herhangi bir sağlayıcı gibi sunabilir: yjs.im için bir `openai-compatible`
düğümü, anahtar başına bir bağlantı.

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --api-key <key>            # or env NINEROUTER_API_KEY
```

Başlatıcı menüsü ve CLI yönlendiricisi aynı bağlayıcıyı sürer:

```bash
node src/launcher.js --connect-9router    # asks for base URL, password and key (the key is not echoed)
node src/cli.js connect --api-key <key>   # the same task, non-interactive
node src/connect-9router.js --help        # every flag and default
```

Varsayılanlar: taban `http://localhost:20128`, parola `123456`, model öneki
`yjs`, düğüm `yjs`, üst akış `https://api.yjs.im/v1`, varsayılan model
`deepseek-v4-flash-0731`. Oluşturulmuş başka bir anahtarı `--name "<label 2>"` ile kaydedin — düğüm kalır ve
her anahtar 9Router'ın yük dengeleyebileceği başka bir bağlantı olur. Ardından 9Router içinde bir model seçin:

```
yjs/deepseek-v4-flash-0731
yjs/glm-5.3
```

## ⚙️ CLI seçenekleri

| görev | bayraklar |
|---|---|
| `mint` | `--count N` (30) · `--conc N` (2) — ayrıca motorun kendi bayrakları (`node src/mint.js --help`) |
| `launcher.js` | etkileşimli: mint / ayarlar (sayı, eşzamanlılık) — `launcher.config.json` içinde kalıcı |

## 🛰️ Proxy arkasında

* `proxies.txt` — satır başına bir çıkış; `scheme://user:pass@host:port`, `scheme://host:port` veya çıplak
  `host:port` (`http://` varsayılanıyla). `#` sonrası yorumlar ve boş satırlar yok sayılır.
* Çıkışlar panele karşı **kullanım anında** doğrulanır; ölü olanlar emekliye ayrılır ve havuz
  yalnızca kullanılabilir küme tükendiğinde yeniden okunur.
* Hiçbir şey kendi arayüzünüzün dışına çıkmaz: her panel isteği (ve posta kutusu trafiği)
  havuzdan geçer.

## 🐞 Sorunlar

Başarısız adımı, kullanılan çıkışı ve aracın stdout çıktısını içeren bir sorun açın — `accounts.json`
ve `outputs/` içindeki hesap başına dökümler, bir anahtarı sızdırmadan hataları yeniden üretilebilir kılar.

## 📄 Lisans

MIT — bkz. [LICENSE](LICENSE). Yalnızca oluşturmanıza izin verilen hesaplarda kullanın.

---