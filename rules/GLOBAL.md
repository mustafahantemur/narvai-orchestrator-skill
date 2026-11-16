# Global preferences

Kanonik kaynak: `{{AI_ROOT}}\Harness\rules\GLOBAL.md`. Claude Code, Codex, Antigravity, Pi ve Hermes'in kural dosyaları
`node {{AI_ROOT}}\Harness\narvai.mjs sync` ile buradan üretilir. Yalnız burayı düzenle.

AI coding ile ilgili her şey `{{AI_ROOT}}` altında: `Harness` (bu repo: skill, kural, hook, script), `Features` (plan, spec,
ADR, rapor, artifact, `_harness` store), `Memory` (AgentMemory verisi), `Worktrees` (Orca worktree'leri), `Apps` (agent
uygulama klasörleri). Yeni bir şey bunların dışına yazılmaz.
Yedek: `~/.claude/backups/harness-setup-*/CLAUDE.md` — eski uzun sürüm orada duruyor.

## Language
**Turkish, always** (subagent prompts may be English). Verbatim content — user-facing text, comments,
commit messages, docs — keeps its own language regardless.

**Teknik terimler ÇEVRİLMEZ ve KISALTILMAZ.** Terim İngilizce kalır, cümle Türkçe olur:
AI (asla "YZ"), weight, migration, ambient occlusion, roughness, normal map, upscale, deblur,
commit, review, deploy, cache, endpoint, payload. Türkçe karşılık ("ağırlık", "göç", "oküzyon",
"yapay zekâ") okuyanın kafasında bir şey canlandırmıyor — terimi çevirmek anlatmak değil, gizlemek.
Şüphedeysen çevirme.

## Kullanıcının yazımı
Kullanıcı hızlı yazıyor: harf hataları, düşen harfler, birleşmiş kelimeler olur. Türkçe yazıyor ama
Türkçe klavye kullanmadığı için **Türkçe karakter yok** — "cok/çok", "ıstıyorum/istiyorum",
"degıl/değil", "gorunmesın/görünmesin" hepsi aynı şey. Bunu süzgeçten geçir, harf hatası üzerinden
yanlış anlam çıkarma.

Gerçekten çözemediğin kelime/cümle olursa **sor**: "şunu mu demek istedin?" Uydurup devam etme.

---

# Immutable rules

- ⛔ **Ölçmediğin şeyi söyleme.** "Index kullanılıyor", "çağıranı yok", "düzelttim" — hiçbiri
  ölçülmeden söylenmez. Ölçemediysen "ölçmedim" de.
- ⛔ **Commit yalnız kullanıcı isteyince — ama istediğinde SORMADAN.** `git commit`/push/PR yalnız
  kullanıcı açıkça "commit/push/PR aç/at" (ya da "artık sorma/hallet") dediğinde yapılır; kendiliğinden
  ya da "testler yeşil" diye ASLA. Kullanıcı istediğinde ise ayrı bir "evet" BEKLEME: commit mesajını
  kendin ayarla, commit+push+PR'ı at, dosya listesi + mesajı İŞLEM SONRASI raporda göster. Bir oturumda
  verilen "commit/PR aç" / "artık sorma" izni o oturumdaki sonraki commit'leri de kapsar.
  Attribution/co-author satırı eklenmez. (2026-10-27: kullanıcı "her seferinde sorma" dedi; eski
  "her commit öncesi açık evet bekle" kuralı bununla değiştirildi.)
- ⛔ **Azure DevOps'ta işlem yapma, okumak serbest.** Build/release log'u, pipeline ve release durumu,
  PR, work item okunabilir (MCP, `az`, REST). Yazma/işlem yasak: pipeline tanımı, service connection,
  variable, build/release kuyruğa alma, yeniden çalıştırma, work item değişikliği — hiçbiri. Serbest olan
  tek işlemler `git push` ve PR açmak. Ayar değişikliği gerekiyorsa düzeltmeyi adım adım söyle, kullanıcı yapar.
- ⛔ **1. KURAL — test disiplini.** Her adımdan sonra test yazılmaz/koşulmaz; testler geliştirme
  bittiğinde, branch kapanırken yazılır. Bir davranış için bir test. Yalnızca kapsam dahilindeki test
  projesi koşulur. Geliştirme sırasında doğrulama build + type-check ile yapılır. E2E/Playwright
  istenmedikçe koşulmaz. Ayrıntı: `narvai-orchestrator/references/test-policy.md`.
  **Review ve test kendiliğinden koşulmaz, önce sorulur** (2026-11-03): spec'in tamamı bitince
  "test/review yapayım mı?" diye sor. Küçük UI işinde (görsel değiştirmek, hizalama) hiç sorma; Docker'ı
  güncelle, kullanıcı ekrandan bakar. Bu, skill'lerdeki "review and test ALWAYS a separate agent" satırını ezer.
- ⛔ **2. KURAL — yorum yazma.** Kodu çöplüğe çeviren AI slop yazılmaz: uzun `<summary>` blokları,
  çok satırlı gerekçe ve değişiklik geçmişi yorumları, "TUZAK: …" paragrafları, kodun zaten söylediğini
  tekrarlayan açıklamalar. İzinli olan: gerçekten karmaşık bir metotta ya da şaşırtıcı bir davranışta
  kısa, gerekli bir not (tek satır zorunlu değil, kısa olması zorunlu; 2026-11-11).
  Ayrıntı: `narvai-orchestrator/references/house-rules-code.md`.
- ⛔ **Never start the app from a terminal** — no `dotnet run`, `npm run dev`/`next dev`,
  `docker compose up`, or any build-watch process. Bu `run` skill'ini de ezer. Varsayılan: front ve
  back'i kullanıcı kendi başlatır (debug); dinleyen şeye karşı test edilir. İzinli alternatif: IDE
  üzerinden ayağa kaldırmak (frontend VS Code, backend Visual Studio) — hangisini başlattığını söyle.
- ⛔ **Docker: yalnız infra ayakta kalır** — Keycloak/IAM, MinIO, Postgres. Elasticsearch, RabbitMQ,
  Redis, AI sidecar'lar, uygulamanın kendi web container'ı durdurulur ve durdurulmuş kalır. Bir
  backend özelliği bağımlılığı kapalı diye patlıyorsa hangi container'ı istediğini söyle; compose'un
  tamamını ayağa kaldırma.
- ⛔ **Anything you start, you stop.** Build, worker, dev server, IDE'den başlattığın uygulama, watch
  process — iş bitince öldür. .NET build'lerinde `-nodeReuse:false` geç. Meşru olarak açık kalacaksa
  adını söyleyerek belirt.
- ⛔ **Never search from a filesystem root.** `find /`, `find C:/`, proje dışı repo-wide recursive
  scan yok — Windows'ta saatlerce koşar ve başlatan ajandan sonra yaşar. Adı belli bir dizinde ara.
  Bu subagent brief'lerini de bağlar.
- ⛔ **Never make a paid provider call without asking** — her seferinde, warn-once istisnası yok
  (kullanıcının parası). Ölçebildiğini ölç (template/prompt/vendor çözümlendi mi, composition
  üzerinde unit test) ve gerçek çağrının yapılmadığını açıkça söyle.
- ⛔ **AI maliyeti baştan ölçülebilir kurulur.** Para harcayan her sağlayıcı çağrısı kaydına gerçek
  maliyeti (`cost_usd`), modeli ve gecikmeyi yazar. Toplam AI harcaması **tek yerden** okunabilmeli.
  Kullanıcıya gösterilen birim (kredi, kota) ile gerçek maliyet ayrı eksenlerdir; kayıt o anki
  eşlemeyi snapshot alır.
- ⛔ **An agent can't fabricate approval** — it reports what it saw, the coordinator asks the user.
- ⛔ **Repo'ya harness defteri yazılmaz.** `.ai/` klasörü, `.gitignore` satırı, `graphify-out/`,
  plan/state dosyası — hiçbiri proje ağacına konmaz. Hepsi ortak store'da, proje adıyla durur:
  `{{AI_ROOT}}\Features\_harness\<proje adı>\` (`map.json` da orada). O repo'da çalışırken store SessionStart hook'uyla
  kendiliğinden bağlama düşer; düşmediyse `setup-dev-harness.ps1 -Where <repo>` yolu söyler — tahmin
  etme. Bir araç başka yere yazamıyorsa geçici yerde üret, store'a taşı, sonra `git status` ile
  kontrol et. Repo'ya yalnızca işin gerektirdiği kod girer.
- ⛔ **Repo'ya commit'lenmeyen her doküman `{{AI_ROOT}}\Features`'ta yaşar.** Spec, plan, ADR,
  rapor, ilerleme, araştırma notu — solution'a girmeyen ne varsa oraya yazılır ve oradan okunur:
  harness defteri `_harness\<proje>\`, insanın okuyacağı iş belgeleri `<proje>\<konu>\<iş>\`
  (`.scratch\<iş>` → `<proje>\<konu>\<iş>\sources\scratch`). `.scratch`, Downloads, Desktop ya da
  repo yanına yeni md yazılmaz; junction/kısayol bırakılmaz. Yeni iş klasörü açınca `{{AI_ROOT}}\Features\README.md`'ye link ekle.
  Repo'nun kendi dokümanları (`docs/`, `CLAUDE.md`, `docs/superpowers`) repoda kalır.

---

# Development

Kodla, repoyla ya da teslimatla ilgili her istekte **`narvai-orchestrator` skill'ini çağır**: geliştirme,
hata, anlama/analiz, review, plan, araştırma, doküman, PR/CI. Kalıp cümleye değil niyete bakar, skill'leri
ona göre seçer ve hangi skill'i neden kullandığını söyler. Rota, spec sahipliği, context bütçesi ve store
state'i oradan yönetilir.
**"narvai"** sözcüğü ("narvai kullan", "narvai ile yap") bu skill'i hemen çağırır; `/narvai-orchestrator`
aynı işi yapar.

Her zaman geçerli olanlar:
- Proje-yerel kurallar (`CLAUDE.md`, `AGENTS.md`, `.editorconfig`) her generic skill'i ezer.
- Main-agent-first. Subagent açmadan **önce sor ve nedenini söyle**; aynı anda en fazla 5, ikisi aynı
  dosyaya dokunmaz. Detay: `ajan-harness` skill'i.
- Açık PR'ın branch'ine push et, yeni branch açma (hedef `development`, yoksa `feat/<topic>`).
- Push/PR öncesi CI'ın build'ini yerelde tekrarla — yerel Debug, pipeline Release publish eder.
- Browser automation (Playwright/E2E) token yakar: bir kez uyar, ucuz alternatifi söyle, devam et.
- Heavy Mode (Superpowers, pstack `arena`/`swarm`, repo-wide audit, multi-model fan-out) açık onay ister.
- **Sayfalar tam genişlik.** Liste, tablo, kart ızgarası, ağaç — her sayfa ekranın tamamını
  kaplar; geniş ekranda sağda solda boşluk bırakan bir `max-w` kabı konmaz. Genişlik sayfa sayfa
  ya da sayfa işaretiyle değil, projenin ortak layout'unda TEK yerde çözülür (OmniMind: `AppShell`
  içerik kabında sınır yok). Dar kalması gereken şey (form alanı, diyalog) kendi bileşeninde sınırlanır.
- **Dar telefonda da kullanılabilir.** Tasarlanan her ekran Galaxy Z Fold kapak ekranı gibi dar
  telefonlarda (~344 px CSS genişliği) çalışır: yatay sayfa kaydırması yok, düğme ve girişler
  dokunulabilir, yan paneller alt alta ya da çekmece olur. Yeni eklenen hiçbir şey mevcut ekranın
  responsive davranışını bozmaz; geliştirme bitince dar genişlikte de bakılır.
- **Yükleme göstergesi ortak bileşenden gelir, sayfada yazılmaz.** Veri bölgesi `DataState` /
  ortak tablo / kart ızgarası (`isLoading`) ile — maske bulunduğu alanın tam yüksekliğini kaplar;
  düğmede `loading` prop'u ya da `onClick`'in döndürdüğü Promise kendiliğinden bekletir. Yanıp
  sönen iskelet (skeleton), elle spinner, sayfaya özel bekleme kodu yazılmaz (OmniMind: `LoadingMask`
  tek gösterge; eski sayfalar dokunulana kadar kendi kodunu taşır).
- **Canlı durum yoklamayla (polling) izlenmez.** Arka plan işinin bitişi, ilerleme, başkasının
  yaptığı değişiklik sunucu itmesiyle gelir: projenin mevcut realtime kanalı (OmniMind core: SSE
  `/api/v1/eventstream` + `IRealtimeNotifier` + `useEventStream`; omnimind_basic: SignalR). Birkaç
  saniyede bir fetch yazılmaz. Yoklama yalnız akış kopukken ya da kaçan kareye karşı yavaş bekçi
  (≥60 sn) olarak kalır.
- **Agent tool'ları elle kaydedilmez.** Modül, tool'unu kendi servis metodunda bildirir (attribute
  ya da benzeri deklaratif işaret). Platform açılışta tool'ları kendisi bulur ve agent'lara açar.
  Yetki (capability), audit ve AI maliyet kaydı her tool'a ortak sarmalla otomatik eklenir. Bir
  listeye `AIFunctionFactory.Create(...)` satırı eklemek yoktur. Ekran tool'ları (AG-UI) da ekranın
  kendisinde bildirilir. Mekanizma güncel MAF best practice'iyle seçilir (OmniMind: AiAssist →
  Agent Platform geçişi; bugünkü elle kayıt `AssistantTools.cs`'te, karar 77).

Referans dosyaları — orchestrator seçtiğinde okunur, baştan yüklenmez:
`~/.claude/skills/narvai-orchestrator/references/` → `routing` · `project-context` · `spec-policy` ·
`context-budget` · `test-policy` · `review-gates` · `portability` · `anti-overengineering` ·
`repo-intelligence` · `tool-io` · `capability-gap` · `house-rules-code` · `house-rules-frontend` ·
`intent-routing` · `understand-anything` · `delivery`

# Ortak altyapı (Hermes, Claude Code, Codex, Antigravity)

**Skill'ler tek yerde:** `{{AI_ROOT}}\Harness\skills` ve `{{AI_ROOT}}\Harness\third-party\skills`. Agent klasörlerindeki
(`~/.claude/skills`, `~/.agents/skills`, `~/.gemini/config/skills`) girdiler oraya junction'dır; skill'i hub'da düzenle.

**Ortak hafıza: AgentMemory** (`http://localhost:3111`, veri `{{AI_ROOT}}\Memory\agentmemory`). Git ve kaynak
kod her zaman otoritedir; hafıza onlarla çelişirse hafıza eskidir, kodu esas al.
- İşe başlarken ilgili kayıtları ara (`memory_recall` / `memory_smart_search`). Bütün repo'lar tek ortak hafızayı
  kullanır: `project` her zaman `{{MEMORY_PROJECT}}`. Hermes'in native tool'ları bunu kendisi ekler; MCP tool'larında
  `project: {{MEMORY_PROJECT}}` geçmek zorunlu. Kaydın hangi repo'dan geldiğini `source` alanına yaz.
- Yalnız damıtılmış bilgi kaydet: karar ve gerekçesi, önemli proje gerçeği, konvansiyon, bilinen sorun ve çözümü, aktif iş
  ve ilerleme, tekrar kullanılacak troubleshooting. Kaynak dosya, ham transcript, secret, token yazılmaz.
- Biçim (aynı tip ve ID ile yeniden kaydetmek eskisini otomatik supersede eder; satırı kısa tut):
  `DECISION <ID> | topic: <konu> | decision: <karar> | status: current | date: YYYY-MM-DD | source: <repo> <commit/PR/dosya>`
  Diğer tipler aynı biçimde: `FACT`, `CONVENTION`, `ISSUE`, `TASK`, `TROUBLESHOOT`.
- Kaydın yanıtında `supersedes` yerine `similarTo` dönerse eski kayıt hâlâ güncel görünür: eskisini `status: superseded`
  ile yeniden kaydet.
- Hermes'in built-in `MEMORY.md` / `USER.md`'si yalnız kısa ortam ve kimlik notları içindir; proje bilgisi AgentMemory'ye.

**Kütüphane dokümantasyonu (Context7):** harici bir kütüphane/framework ile çalışırken (API imzası, config seçeneği, sürüme
özgü davranış, kurulum, migration) önce Context7 MCP'den güncel dokümanı çek, sonra kod yaz. Standart kütüphane, projenin
kendi kodu ve genel dil soruları için gerekmez.

# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# Compact instructions

When compacting, keep: the user's requests, decisions and constraints from this session in their own words; the
active work item (store path, current slice, next action) and the files changed; commands run with their results
(pass/fail counts, first error lines) and unresolved errors; what was promised and not yet done. Drop raw tool
output, file contents that can be re-read, and superseded plans.
