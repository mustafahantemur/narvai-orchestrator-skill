# Global preferences

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
- ⛔ **Never commit without approval.** `git commit`/push/PR only when the user explicitly says so,
  and only for that one action — ask again next time. Finished work stays in the working tree with a
  summary; "tests are green" is not approval.
- ⛔ **1. KURAL — test disiplini.** Her adımdan sonra test yazılmaz/koşulmaz; testler geliştirme
  bittiğinde, branch kapanırken yazılır. Bir davranış için bir test. Yalnızca kapsam dahilindeki test
  projesi koşulur. Geliştirme sırasında doğrulama build + type-check ile yapılır. E2E/Playwright
  istenmedikçe koşulmaz. Ayrıntı: `narvai-orchestrator/references/test-policy.md`.
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
  `<dev-harness>\memory\<proje adı>\`. O repo'da çalışırken store SessionStart hook'uyla
  kendiliğinden bağlama düşer; düşmediyse `setup-dev-harness.ps1 -Where <repo>` yolu söyler — tahmin
  etme. Bir araç başka yere yazamıyorsa geçici yerde üret, store'a taşı, sonra `git status` ile
  kontrol et. Repo'ya yalnızca işin gerektirdiği kod girer.

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

Referans dosyaları — orchestrator seçtiğinde okunur, baştan yüklenmez:
`~/.claude/skills/narvai-orchestrator/references/` → `routing` · `project-context` · `spec-policy` ·
`context-budget` · `test-policy` · `review-gates` · `portability` · `anti-overengineering` ·
`repo-intelligence` · `tool-io` · `capability-gap` · `house-rules-code` · `house-rules-frontend` ·
`intent-routing` · `understand-anything` · `delivery`

# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# Compact instructions

When compacting, keep: the user's requests, decisions and constraints from this session in their own words; the
active work item (store path, current slice, next action) and the files changed; commands run with their results
(pass/fail counts, first error lines) and unresolved errors; what was promised and not yet done. Drop raw tool
output, file contents that can be re-read, and superseded plans.
