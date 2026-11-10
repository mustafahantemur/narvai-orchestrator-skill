# Agentic Dev Harness — kullanım

Konum: `C:\Users\SS\Documents\dev-harness` · Sıfırdan kurulum: `KURULUM.md` · Defter: `notebook.md`

---

## 1. Günlük kullanım: ne diyeceksin

Skill adı ezberlemene gerek yok. Ne istediğini normal cümleyle söyle:

```
Fabric stok sayfasına kalıcı filtre ekleyelim.
Kartela OCR varyant ayrıştırmasını düzeltelim.
Butonu kartın sağ üstüne al.
Dün başladığımız PBR işine devam et.
Bu davranışı istemedim, şöyle değiştir...
Ne değiştirdin göster.
```

`narvai-orchestrator` skill'i işi boyutlandırır ve en hafif rotayı seçer. Non-trivial bir istekte ilk
cevap kısa olur — anladığı iş, repo, mod, spec sahibi, akış, context hedefi, sonunda tek soru:
*devam edeyim mi?* Dev bir plan dökülmez.

| Boyut | Örnek | Ne olur |
|---|---|---|
| TRIVIAL | typo, CSS boşluğu, tek satır | proje kuralları → bul → düzelt → hedefli doğrula. Spec yok, subagent yok |
| SMALL | küçük bug, net CRUD | + micro-spec, kısa plan, lean review |
| STANDARD | gerçek feature, FE+BE | + OpenSpec, onay, slice'lar, stabilizasyon testi, orantılı review |
| LARGE | subsystem, migration | + bounded discovery, roadmap, handoff'lu worker'lar |
| HIGH-RISK | auth, DB şeması, breaking API | + Spec Kit, alternatifler, rollback, açık onay, bağımsız review |

İş sürerken araya girebilirsin: revizyon, kapsam ekleme, geri alma, "ne değiştin göster", duraklat.
Yeni bir spec/ajan açılmaz — aynı iş kalemi devam eder. **Senin istediğin revizyon zaten onaydır**,
ikinci kez sorulmaz.

---

## 2. Store nerede — repo'ya hiçbir şey yazılmaz

`.ai/` klasörü, `.gitignore` satırı, `graphify-out/` — hiçbiri proje ağacına konmaz. Bütün projeler
**tek ortak kökü** paylaşır, her proje kendi adıyla bir klasör alır:

```
C:\Users\SS\Documents\dev-harness\memory\
  map.json                 repo yolu -> store yolu
  omnimind_core\
  omnimind_core_frontend\
```

Her store'un içi:

```
index.md            burada ne var
project-profile.md  navigasyon kartı (stack, komutlar, sınırlar, kaynak referanslarıyla)
requirements.md     kalıcı, feature-üstü ürün niyeti
invariants.md       unutulması kolay, bağlayıcı kurallar
decisions/          ADR
lessons/            tekrar işe yarayacak bulgular
work/<id>/state.yaml  aktif iş checkpoint'i
runtime/            tahminler, lock, session id
graphify/           code graph (graph.json)
```

### Kendiliğinden aktifleşir

O repo'da bir oturum açtığında SessionStart hook'u çalışıyor dizini `map.json` ile eşleştiriyor ve
ajana şunu veriyor: store yolu, hangi dosyalar dolu, açık iş kalemi varsa hangisi ve hangi branch'te,
code graph nerede. Onboard edilmemiş bir dizinde tamamen sessiz — hiçbir şey eklemiyor.

Ölçülen: eşleşen dizinde ~520 ms, eşleşmeyende ~440 ms; hook timeout'u 10 sn.

Hook `~/.claude/settings.json` içinde Orca'nın SessionStart girdisinin **yanına** eklendi, üzerine
yazılmadı — 13 hook noktası ve 19 Orca referansı olduğu gibi duruyor. Açıp kapatmak:

```powershell
.\setup-dev-harness.ps1 -StoreHook Off     # ya da On
```

Hook yoksa (başka harness, subagent, taze shell) yolu sor, tahmin etme:

```powershell
.\setup-dev-harness.ps1 -Where C:\Projects\OmniMindCore\omnimind_core
```

Yeni repo eklemek:

```powershell
.\setup-dev-harness.ps1 -Project C:\path\to\repo
```

Aynı klasör adına sahip ikinci bir repo gelirse kısa bir yol-hash eki alır; `map.json` her hâlükârda
yetkili kaynak.

**Dikkat:** store repo ile versiyonlanmıyor. Push etmek onu yedeklemez ve branch'e göre ayrışmaz —
`state.yaml` içindeki `branch:` alanı devam etmeden önce kontrol edilir. `memory\` klasörünü kendin
yedekle.

---

## 3. Komutlar

### Harness bakımı

```powershell
cd C:\Users\SS\Documents\dev-harness

.\setup-dev-harness.ps1 -Check              # her şey yerinde mi (varsayılan)
.\setup-dev-harness.ps1 -Update             # eksikleri kur, skill'leri senkronla
.\setup-dev-harness.ps1 -Repair             # bozulmuş ayarları düzelt
.\setup-dev-harness.ps1 -Sync               # orchestrator'ı Codex ve Pi'ye kopyala
.\setup-dev-harness.ps1 -Project <repo>     # repo için dış store aç
.\setup-dev-harness.ps1 -Where   <repo>     # store yolunu yazdır
.\setup-dev-harness.ps1 -Graph   <repo>     # code graph üret, store'a taşı, repo'yu temiz bırak
.\setup-dev-harness.ps1 -HeavyMode On|Off   # Superpowers aç/kapat
.\setup-dev-harness.ps1 -RtkHook   On|Off   # RTK şeffaf hook (varsayılan Off — Orca'ya dokunmuyor)
.\setup-dev-harness.ps1 -StoreHook On|Off   # store'un oturum başında otomatik aktifleşmesi (On)
```

> Çıktısını `Select-Object -First N` ile kesme — PowerShell pipeline'ı erken kapatıp uzun süren
> işlemi (özellikle `-Graph`) yarıda öldürür. Gerekirse `| Out-String` ile al, sonra filtrele.

### Code graph (Graphify)

Repo'ya karşı `graphify update` **doğrudan çalıştırılmaz** — çıktı dizini seçilemiyor, repo'yu
kirletir. Sarmalayıcıyı kullan:

```powershell
.\setup-dev-harness.ps1 -Graph C:\Projects\OmniMindCore\omnimind_core
```

Sorgular her zaman `--graph` ile dışarıyı gösterir, `--budget` ile sınırlanır:

```powershell
$g = "C:\Users\SS\Documents\dev-harness\memory\omnimind_core\graphify\graph.json"

graphify query "hangi handler audit kaydı yazıyor" --budget 500 --graph $g
graphify affected "AuditLog" --depth 2 --graph $g
graphify god-nodes --top 10 --graph $g
graphify path "GetAuditLogHandler" "AuditDbContext" --graph $g
graphify explain "AuditLogStore" --graph $g
```

Ölçülen boyutlar: backend 51.944 node / 130.545 edge · frontend 10.110 node / 31.739 edge.
Extraction deterministik ve **LLM çağırmıyor** (`--no-cluster`). Doküman/PDF/görsel semantic pass
varsayılan olarak kapalı — token yakar, ayrıca onay ister.

Graph navigasyon yardımıdır, kanıt değil. Public API, caller, davranış sonuçları LSP/derleyici/
kaynakta doğrulanır. Graph kaynakla çelişiyorsa kaynak kazanır, graph bayattır.

### Gürültülü komut çıktısı (RTK)

Şeffaf hook **kurulu değil** — Orca zaten `settings.json`'daki tüm hook noktalarını kullanıyor,
üzerine yazmak çalışan entegrasyonu riske atardı. Açıkça çağır:

```powershell
rtk dotnet build OmniMind.Core.slnx
rtk dotnet test  tests\Modules\Audit.Tests\Audit.Tests.csproj
rtk pnpm build
rtk diff
rtk err <komut>          # sadece hata/uyarı
rtk test <komut>         # sadece başarısızlıklar
rtk gain                 # ne kadar token kazandırdı
```

**Ölçülen:** `rtk dotnet build` küçük bir csproj'da 436 → 65 char (**%85**). Ama
`rtk git log --stat`'ta kazanç **sıfır** — RTK her komutta işe yaramıyor. Build/test çıktısında
yarıyor, git geçmişinde yaramıyor.

Filtrelenmiş çıktı hatayı teşhis etmeye yetmiyorsa o komut ham tekrar koşulur. Sıkıştırma kanıtı
gizleyemez.

### Spec

```powershell
openspec --help      # 1.13.1 — brownfield STANDARD/LARGE için varsayılan
specify  --help      # Spec Kit 1.0.10.dev0 — greenfield / mimari / breaking / şema / auth
```

Bir feature'ın **tek** canonical spec sahibi olur. OpenSpec + Spec Kit + ayrı bir `SPEC.md`
aynı anda çalışmaz.

### Context bütçesi

```powershell
.\agent-context-budget.ps1 -Path src\Modules\Fabric -Pattern *.cs -Mode STANDARD
.\agent-context-budget.ps1 -Diff -Against origin/development
```

Bu **input payload tahminidir**, canlı model context'i değil — Claude/Codex/Pi bunu script'e
vermiyor. Script de çıktısında bunu yazıyor. Tahmin `byte/3.6` ile yapılıyor; Türkçe metinde
sapma daha yüksek.

---

## 4. Kurulu stack ve rolleri

| Ne | Sürüm | Rolü |
|---|---|---|
| Claude Code | 2.1.278 | ana implementation/planning harness |
| Codex CLI | 0.153.4 | alternatif worker + bağımsız reviewer |
| Pi | 0.87.0 | hafif worker, dar doğrulama işleri — **terminal CLI, uygulama değil** |
| Orca | 1.4.205 | worktree izolasyonu, harness başlatma/devam |
| Addy agent-skills | plugin | varsayılan engineering lifecycle |
| OpenSpec / Spec Kit | 1.13.1 / 1.0.10.dev0 | canonical spec |
| Graphify | 0.9.65 | büyük repo yapısal haritası |
| Ponytail | 4.10.0 | sadelik / anti-overengineering merceği |
| pstack | 0.9.36 (fork) | `unslop`, `how`, `show-me-your-work`, `principle-*` |
| RTK | 0.48.0 | komut çıktısı sıkıştırma |
| Context7 | MCP bağlı | güncel kütüphane dokümanı — koşullu |
| AAS Core | kurulum yok | yetenek boşluğu çözücü, `npx` ile |
| Superpowers | 6.3.0, **kapalı** | Heavy Mode |

`pstack` **fork**: `michael-denyer/pstack-claude`. Upstream `poteto/pstack` yok (404), Lauren Tan'ın
orijinali `poteto/plugins` altında Cursor formatında. Fork olduğu bilinerek, sürüm pinlenerek kuruldu.

---

## 5. Otomatik tetiklenmeyen şeyler

Bunlar kurulu ama **kendiliğinden çalışmaz**, açık onay ister:

- **Superpowers** — `-HeavyMode On`, sonra oturumu yeniden başlat. Kapatmayı unutma.
- **pstack `arena` / `swarm` / `architect` / `blast-radius`** — multi-model fan-out. Normal yolda
  lean design ve impact gate kullanılır.
- **pstack `why`** — tarihsel tasarım niyeti gerçekten gerekliyse.
- **`ponytail-audit`** — repo geneli, elle bakım işi.
- **Graphify doküman/medya semantic pass** — token yakar.
- **AAS Core** — curated stack'te gerçekten boşluk varsa, en fazla 3 aday, en fazla 1 skill.

pstack'in kendi SessionStart auto-routing hook'u kapatıldı (`~/.claude/pstack-models.md` →
`session hook: off`). Tek orchestrator, tek canonical spec — iki araç aynı işi ayrı ayrı planlamaz.

---

## 6. Harness değiştirme

İş `state.yaml`'da durduğu için sohbet geçmişi taşımaya gerek yok.

1. Claude'da bir slice bitir, state güncellensin.
2. Aynı branch/worktree'de Codex ya da Pi aç.
3. `devam et` de.

Karşı taraf store'u bulur, project-profile + canonical spec'in ilgili bölümünü + `git diff`'i okur,
`next_action`'dan devam eder. Tüm repo yeniden taranmaz.

Review'da farklı harness tercih edilir: Claude yazdıysa Codex bakar, Codex yazdıysa Claude.

**Henüz denenmedi:** Codex ve Pi'de gerçek bir resume denemesi yapılmadı, model çağrısı (para/kota)
gerektiriyor. Dosyalar keşif yolunda duruyor ama ikisinde de model çağırmadan skill listeleyen komut
yok. İlk denemede beklenmedik bir şey olursa bu yüzdendir.

**Pi nasıl çalıştırılır:** Pi bir masaüstü uygulaması değil, terminal CLI/TUI'si. Proje dizininde:

```powershell
pi                      # interaktif TUI
pi -p "prompt"          # tek seferlik, çıktı verip çıkar
pi -c                   # kaldığın oturumdan devam
pi -r                   # oturum seç ve devam
```

Orca Pi'yi **birinci sınıf destekliyor**: `orca worktree create --agent pi`. (`orca account add`
yalnız Claude ve Codex hesabı yönetiyor — o ayrı bir şey, ajan başlatmayı engellemiyor.)
Ayrıntı: bölüm 7.

**Pi'nin credential'ı yok:** `pi auth check --provider <p>` üç sağlayıcıda da
`credentials_not_configured` dönüyor. Kullanmadan önce key/OAuth gerekiyor.

---

## 7. Pi kurulumu ve Orca akışı

### 7.1 Pi'ye giriş yap (bir kez)

Pi'nin kendi `pi auth login` komutu **yok** — giriş TUI'nin içindeki `/login` ile yapılıyor.

```powershell
cd C:\Projects\OmniMindCore\omnimind_core
pi
```

TUI açılınca:

1. `/login` yaz → sağlayıcı seç.
   - **Abonelikle** (ek ücret yok): Anthropic Claude Pro/Max, ya da OpenAI ChatGPT Plus/Pro (Codex).
   - **API key ile**: Anthropic, OpenAI, Azure OpenAI, Google Gemini, Google Vertex.
2. `/model` (ya da `Ctrl+L`) → model seç. Seçiliyken `Ctrl+S` onu varsayılan yapar.
   **Bunu atlamayın:** Pi'nin fabrika varsayılanı `google`. Anthropic'e giriş yapıp model seçmezsen
   yanlış sağlayıcıya gider.
3. Çıkmak için `/exit`.

API key'i TUI'siz vermek istersen ortam değişkeni de çalışır:

```powershell
[Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY','sk-ant-...','User')
```

Doğrulama (model çağrısı yapmaz, para harcamaz):

```powershell
pi auth check --provider anthropic --json
# ready  -> tamam
# not_ready / credentials_not_configured -> giriş yapılmamış
```

Credential'lar `~\.pi\agent\auth.json` dosyasına yazılır (şu an 2 byte, yani boş).

Günlük komutlar:

```powershell
pi                  # interaktif TUI
pi -p "prompt"      # tek seferlik, cevabı basıp çıkar
pi -c               # son oturumdan devam
pi -r               # oturum seç ve devam
pi --model anthropic/claude-sonnet-5 "..."   # tek seferlik model override
```

### 7.2 Orca'da kullanmaya başla

Orca'nın `--agent` parametresi `claude`, `codex`, `omp`, `pi`, `grok` ve kurulu diğer TUI ajanlarını
tanıyor. `omnimind_core` Orca'da zaten kayıtlı (`repoId b5b7e0d4-b840-4b50-a511-21afe04e387b`).

**Yeni bir iş için ayrı worktree + ajan (tercih edilen yol):**

```powershell
orca worktree create --name kumas-filtre --agent pi --prompt "..." --json
```

`--agent` ajanı **ilk terminale** koyar; fazladan boş shell açılmaz. Sonra aynı ajanı bir de
`terminal create` ile açma — kural bu.

**Mevcut worktree'de ikinci bir ajan:**

```powershell
orca terminal create --worktree active --command "pi" --json
```

**Terminale konuşmak:**

```powershell
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca terminal send --terminal <handle> --text "devam et" --enter --wait-submit 10 --json
orca terminal read --terminal <handle> --json
```

Handle'ı `worktree create --json` çıktısındaki `startupTerminal.handle`'dan ya da
`orca terminal list --worktree <id> --json`'dan al. Tek handle kullan; Orca yeniden başlarsa
handle bayatlar, yeniden listele.

**Model/effort seçmen gerekiyorsa** `--agent` bunu taşımıyor — worktree'yi ajansız açıp
`terminal create --command 'pi --model anthropic/claude-sonnet-5'` ile başlat.

### 7.3 Store Pi ve Codex'te nasıl bulunuyor

SessionStart hook'u **yalnız Claude Code'a** ait — Pi ve Codex onu çalıştırmıyor. Onlarda store
yolu `narvai-orchestrator` skill'inin talimatıyla bulunuyor: ajan `-Where` çalıştırıp yolu öğreniyor.

```powershell
.\setup-dev-harness.ps1 -Where C:\Projects\OmniMindCore\omnimind_core
```

Pi'ye baştan vermek istersen:

```powershell
pi --append-system-prompt "AI store: C:\Users\SS\Documents\dev-harness\memory\omnimind_core"
```

### 7.4 Önerilen ilk deneme

1. `pi` → `/login` → `/model` → `Ctrl+S` → `/exit`
2. `pi auth check --provider anthropic --json` → `ready` görmelisin
3. Küçük ve doğrulanabilir bir iş seç (tek dosyalık bir düzeltme)
4. `orca worktree create --name deneme --agent pi --prompt "<işin tarifi>" --json`
5. `orca terminal read` ile ne yaptığına bak, `git diff` ile doğrula
6. İşe yaradıysa aynı akışı Claude/Codex ile de dene; yaramadıysa Pi'yi bırak — zorunlu değil

---
## 8. Kurallar nerede duruyor

`~/.claude/CLAUDE.md` küçültüldü (16.261 → ~6.100 byte). Her oturumda yüklü kalanlar: dil kuralları,
onaysız commit yasağı, test disiplini, yorum yasağı, uygulamayı terminalden başlatmama, Docker
politikası, root'tan arama yasağı, ücretli provider çağrısı yasağı, repo'ya harness defteri yazmama.

Geri kalanı orchestrator seçtiğinde okunur:

```
~/.claude/skills/narvai-orchestrator/references/
  routing · project-context · spec-policy · context-budget · test-policy · review-gates
  portability · anti-overengineering · repo-intelligence · tool-io · capability-gap
  house-rules-code · house-rules-frontend
```

`house-rules-code.md` ve `house-rules-frontend.md` senin eski CLAUDE.md'ndeki Coding/Frontend/
"pahalıya öğrenilenler" bloklarının **birebir** kopyası. Hiçbir kural silinmedi.

Eski uzun sürüm: `~/.claude/backups/harness-setup-20260922-111821/CLAUDE.md`.
Küçültme işine yaramazsa o dosyayı geri koyarız.

Orchestrator'ın kaynağı Claude tarafındadır; Codex ve Pi'ye `-Sync` ile kopyalanır. Kopyada elle
değişiklik yaparsan `-Sync` dosya adıyla uyarır ve üzerine yazar — düzenleme her zaman
`~/.claude/skills/narvai-orchestrator/` altında yapılır.

---

## 9. Sorun giderme

**Skill görünmüyor** → `.\setup-dev-harness.ps1 -Check`, plugin satırlarına bak. Plugin
açıp kapattıysan oturumu yeniden başlat.

**`specify` / `graphify` / `rtk` bulunamıyor** → yeni PATH girdileri var, terminali yeniden aç.
Script PATH'i registry'den kendisi tazeliyor, elle çalıştırdığında shell'in eski kopyası kalmış olabilir.

**Repo'da `graphify-out/` belirdi** → bir `-Graph` çalışması yarıda kesilmiş. Sil, tekrar çalıştır:
`Remove-Item <repo>\graphify-out -Recurse -Force`.

**Orca bozulduysa** → RTK hook'u sen açtıysan (`-RtkHook On`) geri al:
`~/.claude/backups/harness-*/settings.json` dosyasını yerine koy.

**Bir şeyi geri almak** → `~/.claude/backups/harness-setup-20260922-111821/` içinde kurulumdan
önceki `settings.json`, `CLAUDE.md`, Codex `config.toml` ve `AGENTS.md` duruyor.

---

## 10. Yönetici ilkesi

> projeyi anla → spec'i canlı tut → sadece yetecek kadar planla → incelenebilir slice'larla yaz →
> kullanıcıyla sürekli revize et → anlamlı testlerle stabilize et → bağımsız doğrula → sadeleştir →
> taşınabilir state'i koru

Amaç ajan aktivitesini ya da framework kullanımını artırmak değil. Context depolama değil, bütçedir.
