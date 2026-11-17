# narvai kullanım kılavuzu

Bu dosya "şunu yapmak istiyorum, hangi komut?" sorusuna cevap verir. Parçaların ne olduğu `README.md` içinde anlatılıyor.

Komutlar her dizinden çalışır. Repoya bağlı olanlar (`context`, `next`, `verify`, `tests`, `contract`) o reponun içinden çalıştırılır. `<store>`, `~/.narvai/config.json` içindeki `storeRoot` klasörüdür.

## Günlük iş

Ajan bu komutları kendisi çalıştırır. Sen de aynı çıktıyı görmek için çalıştırabilirsin.

| Ne zaman | Komut | Ne verir |
|---|---|---|
| Bir repoda kod işine başlarken | `narvai context` | Proje ve stack kuralları, kontroller, açık iş, hafızanın durumu |
| Bir adımın skill'ini görmek için | `narvai next --event <adım> [--paths <dosyalar>]` | O adım için okunacak skill dosyaları |
| "Bitti" demeden önce | `narvai verify` | Build, typecheck ve lint; hata varsa ilk hata satırları |
| Testleri de koşmak istediğinde | `narvai verify --tests` | Yukarıdakiler ve test kontrolleri |
| Kırmızı bir testte | `narvai tests --failed <test dosyası>` | Test mi kaynak mı daha sonra değişmiş |
| Endpoint, DTO ya da enum değişince | `narvai contract` | Backend ve istemci tarafında sırayla yapılacaklar |

Adımlar: `unclear`, `idea`, `plan`, `build`, `edit`, `library`, `refactor`, `migrate`, `failure`, `tests`, `perf`, `done`, `review`, `decision`, `prose`, `ship`. `edit`, `refactor`, `review`, `tests` ve `perf` dosya türüne göre ek skill verir; onlarda `--paths` kullan:

```
narvai next --event review --paths src/Modules/Catalog/Catalog.Application/Handlers/Colors/CreateColorHandler.cs
```

`narvai verify` yalnız değişen dosyalara uyan kontrolleri koşar. `--all` hepsini koşar. `--changed`, klasöre bağlı kontrolleri yalnız değişen klasörlerde koşar.

## Yeni bir repo eklemek

1. `<store>/map.json` dosyasına repo yolunu ve store klasörünü ekle:

   ```json
   { "C:\\Projects\\Ornek\\api": "C:\\Projects\\AI\\Features\\_harness\\ornek_api" }
   ```

2. Store klasörüne proje kurallarını yaz: `project-rules.md`. İlk satır `include: ../ortak/rules.md` olursa o dosya da eklenir; birkaç reponun ortak kuralları böyle tek yerde durur.
3. Profilin kontrolleri yetmiyorsa `verify.json` yaz. `kind: "test"` olan kontrol yalnız `--tests` ile koşar:

   ```json
   { "checks": [
       { "name": "build", "when": ["**/*.cs"], "run": "dotnet build Ornek.slnx -c Release -m:2 -nodeReuse:false -v:q" },
       { "name": "unit", "when": ["**/*.cs"], "run": "dotnet test tests/Ornek.UnitTests --no-build -v:q", "kind": "test" }
     ],
     "manual": ["integration testleri Docker ister"] }
   ```

4. Git hook'larını kur: `narvai hooks <repo>`. Push'tan önce `narvai verify --changed` koşar, commit'te testine dokunulmamış kaynakları listeler. Kaldırmak için `narvai hooks <repo> --remove`.
5. `narvai context` ile bak: stack tanındı mı, kurallar ve kontroller doğru mu.

Repo `.git/hooks` yerine izlenen bir klasör kullanıyorsa (`core.hooksPath`) narvai oraya yazmaz ve bunu söyler.

## Kuralları değiştirmek

| Hangi kural | Dosya | Sonra |
|---|---|---|
| Kişisel kuralların | `~/.narvai/rules.md` | `narvai sync` |
| Çekirdek kurallar | `rules/core.md` (bu repoda) | `narvai sync` |
| Bir projenin kuralları | `<store>/<proje>/project-rules.md` | Bir şey gerekmez; `narvai context` dosyayı her seferinde okur |
| Bir stack'in kuralları | `profiles/<stack>/rules.md` | Bir şey gerekmez |

`narvai sync` ajanların kural dosyalarını yeniden üretir (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`). Açık oturumlar eski kuralları taşır; değişiklik yeni oturumda geçerli olur. `narvai doctor` üretilen dosya 100 satırı geçerse uyarır.

Kural metni emir kipinde yazılır. Ölçüldü: "her adımda `narvai next` çalıştır ve oku" cümlesi "narvai next şu adımlar için skill'leri adlandırır" diye yumuşatılınca ajanların skill okuması 8 senaryoda 7'den 3'e düştü.

## Yasaklar (guard)

Hook bir komutu reddederse ajana nedenini ve yerine ne yapacağını söyler. Ajan yasağı kaldıramaz.

| İş | Nasıl |
|---|---|
| Bir yasağı geçici kaldırmak | Kendi terminalinde `narvai allow <kural-id> --minutes 60` (varsayılan 30, en fazla 480) |
| Kendi yasağını eklemek ya da silmek | `~/.narvai/guard.json` dosyasını kendin düzenle |
| Kuralların derlendiğini görmek | `narvai doctor` ("guard rules compile") |

`narvai allow` terminal ister; bu yüzden ajanın kabuğundan çalışmaz. Ajan `~/.narvai/guard.json` ve `~/.narvai/allow.json` dosyalarına da dokunamaz.

Bir kural şöyle görünür. `command` bir regular expression; `tool` verilmezse kural kabuk komutlarına uygulanır:

```json
{ "rules": [
  { "id": "app-run",
    "command": "(?:^|[;&|(]\\s*)dotnet\\s+(?:run|watch)(?=\\s|$)",
    "reason": "The user starts the app from the IDE.",
    "instead": "test against what is already listening." }
] }
```

Hazır gelen kurallar (`hooks/deny.json`): dosya sistemi kökünden arama (`root-find`, `root-list`, `root-ls`, `root-grep`, `root-cd`) ve kaldırılamayan üç kural (`narvai-allow`, `guard-files-shell`, `guard-files-edit`). `hooks/deny.json` elle düzenlenmez; `hooks/build-deny.mjs` dosyasını değiştirip `node hooks/build-deny.mjs` çalıştır.

## Skill'ler ve rotalar

| İş | Komut |
|---|---|
| Bir skill nerede, hangi rotada | `narvai skill <ad>` |
| Bütün skill'ler | `narvai skill --list` (bir stack için `--stack dotnet`) |
| Hangi skill gerçekten kullanılmış | `narvai usage --days 30` (`--all` kullanılmayanların hepsini listeler) |
| Bir klasörü okumanın token maliyeti | `narvai estimate <yol>` (`--diff` yalnız değişenleri sayar) |

Rota eklemek ya da değiştirmek için `registry/routes.json` dosyasını düzenle, sonra `narvai sync` ve `narvai doctor`. Bir rota en fazla üç skill taşır. `when.except` test, stories ya da üretilmiş dosyaları rotanın dışında tutar. Skill'i olmayan rota tek satırlık bir not basar.

Bir projenin kendi tasarım skill'i varsa store'daki `project-profile.md` dosyasına şu satırı yaz; UI rotası ve hook onu adıyla gösterir:

```
Design skill: `omnimind-ui`
```

## Kod graph'ları

Graph'lar `<store>/graph/` altında durur, repoya bir şey yazılmaz. Hangi repoların graph'ı kurulacağı `<store>/graph/repos.json` dosyasında yazılıdır.

| İş | Komut |
|---|---|
| Hangi graph güncel | `narvai graph status` |
| Bir repoyu çalışma ağacından kurmak (commit'lenmemiş dosyalar dahil) | `narvai graph build --only <repo> --worktree` |
| Bir repoyu son commit'ten kurmak | `narvai graph build --only <repo> --head` |
| Bütün repoları `origin/<dal>` üzerinden kurmak | `narvai graph build` |
| Yalnız birleşik graph'ı yenilemek | `narvai graph build --merge` |
| Bayatsa yenilemek, değilse bir şey yapmamak | `narvai graph refresh` (30 dakika beklemeden: `--now`) |

Oturum başında hook, bulunduğun repo için `narvai graph refresh` komutunu arka planda başlatır. Graph bayatsa ve son kurulumun üstünden 30 dakika geçtiyse yeniden kurulur. Süreyi `config.json` içindeki `graphMinutes` belirler. Ölçülen süreler: frontend (1.900 dosya) 167 sn; Core'da (6.000 dosya) yalnız Graphify adımı 352 sn.

`narvai graph status` çıktısındaki durumlar:

- `current (working tree)`: graph, commit'lenmemiş değişiklikler dahil şu anki dosyalarla aynı.
- `current (HEAD)`: çalışma ağacı temiz ve graph son commit'te.
- `current (origin/<dal>); the working tree differs`: graph uzak dalın ucunda; yerel kopya farklı.
- `stale`: repo kurulumdan sonra değişti.

Ajan için graph isteğe bağlıdır. Ölçümde graph kullanan ajan daha doğru cevap vermedi; `skills/narvai-orchestrator/references/graphs.md` ne zaman sorgulamaya değdiğini söyler.

Bir alanı kendin görmek için görsel sayfayı Graphify üretir (model çağırmaz). Küçük bir repoda ya da tek bir modül klasöründe:

```
graphify update "<store>/graph/<repo>/src/Modules/<Modül>" --no-cluster
graphify cluster-only "<store>/graph/<repo>/src/Modules/<Modül>" --no-label
```

Sayfa o klasörün `graphify-out/graph.html` dosyasıdır. Bütün bir büyük repo için sayfa ağır olur; modül modül üret.

## Ortak hafıza

`narvai context` hafızanın cevap verip vermediğini yazar. Kapalıysa `config.json` içindeki `memory.start` komutunu çalıştırır ve 25 saniyeye kadar bekler.

| İş | Komut |
|---|---|
| Durum | `agentmemory status` |
| Elle yeniden başlatmak (Windows) | `agentmemory stop`, sonra `schtasks /run /tn "AgentMemory (unified-harness)"` |
| Kontrol | `narvai doctor` ("shared memory reachable") |

Windows'ta zamanlanmış görev oturum açılışında ve her 15 dakikada bir çalışır; sunucu ayaktaysa dokunmaz, kapalıysa yeniden başlatır. Sunucunun günlüğü `~/.agentmemory/compose-3111.log` dosyasıdır.

## Sağlık kontrolü ve sorun giderme

`narvai doctor` kurulumu, kural dosyalarının boyutunu, rotaları, guard kurallarını, hafızayı ve graph'ları denetler. `narvai doctor --fix`, `sync` ile düzelebilenleri düzeltir.

| Belirti | Çözüm |
|---|---|
| `narvai: command not found` | `node <harness>/narvai.mjs sync`. Komut `~/.local/bin` klasörüne yazılır; o klasör PATH'te değilse `~/.narvai/bin` klasörünü PATH'e ekle |
| Codex'te hook çalışmıyor | Codex'te `/hooks` aç, narvai girdilerine güven ver |
| Kural değişti ama ajan eskisini izliyor | Yeni oturum aç |
| Üretilen kural dosyası 100 satırı geçti | `~/.narvai/rules.md` ya da `rules/core.md` içinden satır çıkar, `narvai sync` |
| Push'ta `narvai verify failed` | Hatayı düzelt. Riski kabul ediyorsan `git push --no-verify` |
| lefthook ya da husky hook dosyalarını yeniden yazdı | `narvai hooks <repo>` |
| Graph hep bayat görünüyor | `narvai graph build --only <repo> --worktree`; günlük için komutu elle çalıştırıp çıktıya bak |
| Skill listesi Codex sınırını aşıyor | `registry/routes.json` içindeki `listed` ve profillerdeki `skills` listelerinden çıkar, `narvai sync` |

## Davranış testi (eval)

`narvai eval`, `evals/scenarios.json` içindeki senaryoları her biri yeni bir headless Claude Code oturumunda koşturur. Senaryolar dosya değiştirdiği için gerçek repoda değil, atılabilir bir worktree'de koşar.

1. Worktree aç:

   ```
   git -C <repo> worktree add --detach <klasör> HEAD
   ```

2. `~/.narvai/config.json` içine yaz:

   ```json
   "evalRepos": { "web": "<frontend worktree>", "dotnet": "<backend worktree>" }
   ```

3. Koştur:

   | İş | Komut |
   |---|---|
   | Hepsi | `narvai eval` |
   | Seçilenler | `narvai eval --only=stale-test,prose` |
   | Çalıştırmadan listelemek | `narvai eval --dry-run` |
   | Kayıtlı bir koşuyu yeniden puanlamak | `narvai eval --rejudge=<koşu klasörü>` |

Kayıtlar `<store>/dev-harness/evals/<zaman>/` altında durur: senaryo başına transkript ve `results.json`. Koşular aboneliği kullanır; bir API anahtarı tanımlıysa eval çalışmayı reddeder.

## Harness'ı güncellemek

```
git -C <harness> pull
narvai sync
narvai doctor
```

Bu repoda değişiklik yaptıysan önce `node --test tests/*.test.mjs` koştur. Vendored bir skill setini güncelleme adımları `README.md` sonunda.

## Dosyalar nerede

| Dosya | Yer |
|---|---|
| Ayarlar | `~/.narvai/config.json` |
| Kişisel kurallar, yasaklar | `~/.narvai/rules.md`, `~/.narvai/guard.json` |
| Geçici istisnalar | `~/.narvai/allow.json` |
| Yedekler (sync'in değiştirdiği her dosya) | `~/.narvai/backups/` |
| Repo ile store eşlemesi | `<store>/map.json` |
| Proje kuralları, kontroller, iş durumu | `<store>/<proje>/project-rules.md`, `verify.json`, `work/<id>/` |
| Graph'lar | `<store>/graph/` |
| Eval kayıtları | `<store>/dev-harness/evals/` |
