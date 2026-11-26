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
| Kendi yasağını eklemek, değiştirmek ya da silmek | `~/.narvai/guard.rules.mjs` dosyasını düzenle, sonra `narvai guard apply` |
| Yürürlükteki kuralları ve son değişikliği görmek | `narvai guard` |
| Kuralların derlendiğini görmek | `narvai doctor` ("guard rules compile") |

`narvai allow` terminal ister; bu yüzden ajanın kabuğundan çalışmaz. Ajan `~/.narvai/guard.json`, `~/.narvai/allow.json` ve `~/.narvai/guard.log` dosyalarına doğrudan dokunamaz.

Kuralları ajana da değiştirtebilirsin: ajan kaynağı düzenler ve `narvai guard apply` çalıştırır. Komut kuralları denetler, eski dosyayı yedekler ve değişikliği kaydeder. `narvai guard` ve `narvai doctor` son değişikliği kimin yaptığıyla birlikte gösterir:

```
last change 2026-11-17 by claude: +memory-by -compose-up
```

Bir kural şöyle görünür. `command` bir regular expression; `tool` verilmezse kural kabuk komutlarına uygulanır. `String.raw` sayesinde ters eğik çizgileri ikilemen gerekmez:

```js
const r = String.raw;
export const rules = [
  { id: 'app-run',
    command: r`(?:^|[;&|(]\s*)dotnet\s+(?:run|watch)(?=\s|$)`,
    reason: 'The user starts the app from the IDE.',
    instead: 'test against what is already listening.' },
];
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
Design skill: `shop-ui`
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

Bir kaydı kimin yazdığını görmek için kayıt biçimine bir `by` alanı ekleyebilirsin: `| by: <harness>/<model>/<efor>`, örneğin `| by: claude-code/claude-opus-5-5/high`. Bunu zorunlu kılan kural senin yasak kurallarına yazılır; `by` taşımayan kaydı hook reddeder:

```js
{ id: 'memory-by',
  tool: r`^mcp__agentmemory__memory_save$`,
  command: r`^(?![\s\S]*\|\s*by:\s*[\w.-]+/[\w.:-]+)`,
  reason: 'A shared memory record says who wrote it.',
  instead: 'end the record with `| by: <harness>/<model>`.' },
```

Alanı ajan kendisi yazar; hook yalnız var olup olmadığına bakar, doğruluğunu denetlemez.

### Hafıza graph'ı

AgentMemory kendi graph'ını yalnız oturum gözlemlerinden doldurur; `memory_save` ile yazılan kayıtlar oraya girmez. narvai graph'ı kayıtlardan üretir ve içeri alır. Model çağrılmaz.

| İş | Komut |
|---|---|
| Graph'ı kayıtlarla eşitlemek | `narvai graph memory` |
| Sıfırlayıp baştan kurmak | `narvai graph memory --reset` |
| AgentMemory'nin graph index'ini ilk kez açmak | `narvai graph memory --migrate` (`narvai setup` bunu yapar) |
| Güncel mi | `narvai graph status` (son satır) |
| Görmek | AgentMemory viewer, `http://localhost:3113/#graph` |

Elle çalıştırman gerekmez. Hook aynı eşitlemeyi oturum başında ve bir kayıt yazıldıktan on saniye sonra arka planda başlatır. Yeni bir şey yoksa durur. Yalnız ekleme varsa üstüne ekler. Bir node ya da ilişki kalktıysa graph'ı sıfırlar ve baştan içeri alır. 190 node ve 620 ilişki yaklaşık bir dakika sürer.

Proje ayarı olmadan graph'ta her güncel kayıt, kaydın etiketleri (`concepts`) ve `source` alanındaki dosyalar yer alır. Daha fazlası için `<store>/graph/memory/<memoryProject>.json` dosyasını yaz:

```json
{
  "decisions": { "file": "C:/.../00-kararlar.md", "label": "Karar", "settled": "Kesin" },
  "skipTags": "^by-",
  "entities": {
    "Catalog": ["catalog"],
    "SG": ["=sg"],
    "trend": ["^trend"],
    "iş panosu": ["iş pano", "=pano"]
  },
  "relations": [["iş panosu", "uses", "TaskInbox"]]
}
```

- `decisions.file`: ilk sütunu `#` olan bir markdown tablosu; sütunlar numara, konu, karar, durum. Her satır bir karar node'u olur. `settled` dışındaki durum adın sonuna yazılır. Bir kayıt "karar 12" ya da "kararlar 12, 19" diye geçirirse o kararlara bağlanır.
- `entities`: ad ve aranacak yazımlar. Yazımlar küçük harfle yazılır. `=sg` tam sözcük, `^trend` sözcük başı, diğerleri düz kalıptır. Yazımı geçen her kayıt ve karar o ada bağlanır.
- `relations`: adlar arasında elle yazılan ilişki; tür `uses`, `depends_on` ya da `related_to`.
- `skipTags`: graph'a girmeyecek etiketlerin kalıbı.

## Code Mode (Claude Code)

Claude Code'un deneysel Code Mode'u araç çağrılarını tek bir JavaScript betiğinde toplar: aramalar ve komutlar paralel koşar,
bir sonucun gereken kısmı bir sonrakine geçer, Claude yalnız gereken satırları okur. Arka arkaya çok arama, okuma ya da kontrol
gereken işte context ve token tasarrufu sağlar.

- `narvai sync`, `~/.claude/settings.json` içine `"env": { "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE": "1" }` yazar; değer zaten
  varsa dokunmaz. Kapatmak için değeri `"0"` yap; sync onu bırakır.
- Claude Code v2.1.323 ya da sonrası gerekir. İlk açılışta onay sorar ve yeniden başlar. VS Code paneli, Desktop ve bulut
  oturumlarında çalışmaz; terminalde (Orca dahil) çalışır.
- Guard bozulmaz: betikten yapılan her Bash, Edit, Write ve MCP çağrısı `PreToolUse` hook'undan kendi adıyla geçer; yasak
  kuralları birleşik komutları (`cd x && git push`) da yakalar.
- Review ajanı (`narvai-gozden-gecir`) betik yazabilir (`REPL`). Keşif ajanı salt okunur kaldığı için eklenmedi.
- `narvai doctor` durumu gösterir.

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
| Hafıza graph'ı boş ya da bayat | `narvai graph memory`; çıktı index'in açılmadığını söylüyorsa `narvai graph memory --migrate` |
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

Repodaki `evals/scenarios.json`, yazıldığı iki reponun dosyalarını sorar. Başka repolar için kendi senaryolarını `<store>/dev-harness/evals/scenarios.json` dosyasına yaz; varsa `narvai eval` onu kullanır.

Kayıtlar `<store>/dev-harness/evals/<zaman>/` altında durur: senaryo başına transkript ve `results.json`. Koşular aboneliği kullanır; bir API anahtarı tanımlıysa eval çalışmayı reddeder.

## Harness'ı güncellemek

```
git -C <harness> pull
narvai sync
narvai doctor
```

Bu repoda değişiklik yaptıysan önce `node --test tests/*.test.mjs` koştur. Vendored bir skill setini güncelleme adımları `README.md` sonunda.

## Başka bir makineye kurmak

Kurulumun tamamı bu repodan ve içindeki komutlardan gelir. Repoda olmayan üç şey sana aittir; eski makineden kopyalarsın ya da boş başlarsın:

| Ne | Nerede | Yoksa |
|---|---|---|
| Kişisel kurallar ve yasakların kaynağı | `~/.narvai/rules.md`, `~/.narvai/guard.rules.mjs` | Yalnız `rules/core.md` ve repodaki yasaklar geçerli olur |
| Store | `<kök>/Features/_harness` | `map.json` boş başlar; proje kuralı, kontrol ayarı ve graph yoktur |
| Ortak hafızanın verisi | `<kök>/Memory/agentmemory` | Hafıza boş başlar |

1. Node 22, git ve kullandığın ajanları kur: Claude Code, Codex.
2. Ortak hafıza için `npm install -g @agentmemory/agentmemory@0.9.33`. Kod graph'ları için `uv tool install graphifyy` ve `~/.understand-anything-plugin` altında Understand-Anything plugin'inin bir kopyası. Plugin yoksa `install` klonlama komutunu yazar; PATH'te olmayan aracı `narvai doctor` bildirir.
3. Repoyu klonla ve `node narvai.mjs setup --root <kök>` çalıştır. setup önce `install` yapar, sonra bulduğunu ayarlar: AgentMemory'nin ayarları, Windows'ta yeniden başlatma görevi, her ajandaki MCP kaydı ve graph index'i; ardından Hermes, Codex ve Orca. Sonunda elle yapılacakları listeler.
4. Yasak kuralı getirdiysen `narvai guard apply`, sonra `narvai doctor`.
5. Codex'te `/hooks` aç ve narvai girdilerine güven ver.
6. Her repo için "Yeni bir repo eklemek" adımları.

`setup` ve `install` yeniden çalıştırılabilir. Yollar `~/.narvai/config.json` dosyasından okunur.

## Dosyalar nerede

| Dosya | Yer |
|---|---|
| Ayarlar | `~/.narvai/config.json` |
| Kişisel kurallar | `~/.narvai/rules.md` |
| Yasakların kaynağı, yürürlükteki hali, değişiklik kaydı | `~/.narvai/guard.rules.mjs`, `~/.narvai/guard.json`, `~/.narvai/guard.log` |
| Geçici istisnalar | `~/.narvai/allow.json` |
| Yedekler (sync'in değiştirdiği her dosya) | `~/.narvai/backups/` |
| Repo ile store eşlemesi | `<store>/map.json` |
| Proje kuralları, kontroller, iş durumu | `<store>/<proje>/project-rules.md`, `verify.json`, `work/<id>/` |
| Graph'lar | `<store>/graph/` |
| Hafıza graph'ının proje ayarı | `<store>/graph/memory/<memoryProject>.json` |
| Son içeri alınan hafıza graph'ı | `~/.agentmemory/graph-import/<memoryProject>.json` |
| Eval kayıtları | `<store>/dev-harness/evals/` |
