# Sıfırdan kurulum — başka bir PC'de

## Her ortamda (Windows, macOS, Linux): node CLI

Önkoşul: node 22+ ve git. Klasörü kopyala, sonra:

```
node narvai.mjs install    # ~/.narvai/config.json, narvai skill'i (Claude, Codex, Pi, varsa Qwen), Pi kuralları,
                           # Codex/Qwen pointer'ı, vendor edilmiş üçüncü parti skill'ler, Claude hook'ları
node narvai.mjs doctor     # ne kurulu, ne eksik, ne bayat
```

Sonra `~/.narvai/config.json`'da `storeRoot`, `docsRoot`, `language`, `evalRepos` alanlarını düzenle. Her repo için
store'daki `map.json`'a bir satır ekle ve `node narvai.mjs hooks <repo>` ile pre-push kapısını kur.
Diğer komutlar: `sync`, `usage`, `estimate`, `verify`, `eval` (`node narvai.mjs` listeler). Üçüncü parti kaynaklar ve
yerel değişiklikler: `third-party.json`. Claude Code plugin'leri `/plugin` ile kurulur (listesi `third-party.json`'da).

Aşağıdaki PowerShell yolu yalnız Windows'ta ve ek işler için (graph, araç kontrolleri) duruyor.

## Windows: PowerShell installer

Bu klasörün tamamını yeni makineye kopyala, `install-dev-harness.ps1`'i çalıştır. Gerisi otomatik.

Klasör `Belgeler` altında durabilir (burada olduğu gibi) ya da başka bir yerde — script kendi
konumuna göre çalışır, sabit yol yok.

---

## 1. Önkoşullar (elle, bir kez)

Bunlar olmadan installer başlamaz ve sana hangisinin eksik olduğunu söyler:

| Ne | Nereden |
|---|---|
| Windows 10/11 | — |
| PowerShell 7+ | `winget install Microsoft.PowerShell` |
| winget | Microsoft Store → "App Installer" |
| Git | https://git-scm.com/download/win |
| Node.js LTS | https://nodejs.org |

Python zorunlu değil — `uv` kendi runtime'ını getirir. Kuruluysa Spec Kit ve Graphify daha hızlı kurulur.

---

## 2. Klasörü kopyala

```
<yeni pc>\Users\<sen>\Documents\dev-harness\
```

`memory\` klasörünü de kopyalarsan proje hafızası (project-profile, requirements, decisions,
açık iş kalemleri) beraber gelir. Ama içindeki `map.json` **eski makinenin repo yollarını**
tutuyor — yeni makinede repo'lar başka yerdeyse her repo için bir kez şunu çalıştır:

```powershell
.\setup-dev-harness.ps1 -Project <yeni repo yolu>
```

Bu, map'i yeni yola göre günceller. Store klasörü proje adıyla adlandırıldığı için içerik kaybolmaz.

Code graph'i (`memory\*\graphify\`) kopyalama — büyük ve makineye özgü, yerinde yeniden üret.

---

## 3. Installer'ı çalıştır

```powershell
cd $HOME\Documents\dev-harness

.\install-dev-harness.ps1 -DryRun     # önce ne yapacağını gör, hiçbir şey değişmez
.\install-dev-harness.ps1             # gerçek kurulum
```

Seçenekler:

```powershell
.\install-dev-harness.ps1 -SkipTools               # CLI'lar zaten kuruluysa, sadece yapılandır
.\install-dev-harness.ps1 -MemoryRoot D:\ai-memory # store kökünü başka diske al
```

Idempotent — ikinci kez çalıştırınca sadece eksikleri tamamlar.

### Ne kuruyor

**Harness'lar:** Claude Code (yoksa npm ile), Codex (masaüstü app varsa PATH shim, yoksa npm ile),
Pi (npm). Orca opsiyonel ve masaüstü uygulaması — onu sen kurarsın.

**Araçlar:** uv, RTK (winget), OpenSpec (npm), Spec Kit (uv + git), Graphify (uv).
RTK'nın doğru olanı kurulduğunu `rtk gain` ile doğruluyor — crates.io'da aynı isimde alakasız bir
paket var, yanlış olan kurulduysa sana söylüyor.

**Claude Code plugin'leri:** Addy agent-skills, Ponytail, pstack (fork: `michael-denyer/pstack-claude`),
csharp-lsp, typescript-lsp açık. Superpowers kurulu ama **kapalı** — Heavy Mode, açık onayla açılır.

**Politika anahtarları:** pstack'in SessionStart auto-routing hook'u kapatılır
(`pstack-models.md` → `session hook: off`). RTK'nın şeffaf hook'u **kurulmaz** — Orca'nın hook
zincirine dokunmamak için; `rtk <komut>` açıkça çağrılır.

**Orchestrator skill:** bu klasördeki `skills\narvai-orchestrator\` tek doğruluk kaynağı. Claude,
Codex ve Pi'ye kopyalanır; her dosyanın SHA256'sı `sync-manifest.json`'a yazılır, sonraki
`-Sync` sapan dosyayı adıyla uyarır.

**Store hook'u:** `hooks\ai-store-context.cmd` SessionStart'a, varsa Orca girdisinin **yanına**
eklenir — üzerine yazılmaz.

**Global CLAUDE.md:** yoksa `templates\CLAUDE.md`'den kurulur. Varsa **dokunulmaz**, sadece
`narvai-orchestrator` yönlendirmesi yoksa sonuna eklenir ve önce `.bak` alınır.

---

## 4. Installer'ın yapmadıkları

Bittiğinde ekrana numaralı liste basıyor. Özet:

1. **Claude Code girişi** — `claude` çalıştır, giriş yap.
2. **Codex girişi** — `codex` çalıştır, giriş yap.
3. **Pi credential** — `pi auth check --provider anthropic` `credentials_not_configured` derse
   key/OAuth girilmemiş demektir. Pi'yi kullanmayacaksan atlayabilirsin.
4. **Orca** (opsiyonel) — masaüstü uygulaması, ayrıca kurulur.
5. **Terminali yeniden aç** — yeni PATH girdileri için.
6. **Claude Code oturumunu yeniden başlat** — plugin ve hook değişiklikleri için.
7. **Her repo için bir kez:**
   ```powershell
   .\setup-dev-harness.ps1 -Project <repo yolu>   # dış store
   .\setup-dev-harness.ps1 -Graph   <repo yolu>   # code graph
   ```

---

## 5. Doğrulama

```powershell
.\setup-dev-harness.ps1 -Check
```

Beklenen: tüm araçlar sürümüyle `[ OK ]`, plugin satırları doğru açık/kapalı, dört politika
anahtarı yeşil, üç harness'ta da orchestrator skill'i mevcut.

Hook'u ayrıca deneyebilirsin — onboard edilmiş bir repo'da JSON, başka yerde `{}` basmalı:

```powershell
$env:CLAUDE_PROJECT_DIR = '<onboard edilmis repo>'
.\hooks\ai-store-context.cmd SessionStart
```

---

## 6. Sorun çıkarsa

**`specify` / `graphify` / `rtk` bulunamıyor** → terminali yeniden aç. Script PATH'i registry'den
tazeliyor ama senin shell'inin kopyası eski kalmış olabilir.

**Yanlış `rtk`** → `cargo uninstall rtk`, sonra `winget install rtk-ai.rtk`. Doğrusunda `rtk gain` çalışır.

**Plugin marketplace eklenemedi** → ağ/proxy. `claude plugin marketplace add <repo>` elle dene.

**Hook oturumu yavaşlatıyor** → `.\setup-dev-harness.ps1 -StoreHook Off`. Ölçülen süre ~440-520 ms,
timeout 10 sn.

**Bir şeyi geri almak** → installer ve setup, değiştirdiği her dosyanın zaman damgalı yedeğini
`~\.claude\backups\` altına alıyor.

---

## 7. Klasör içeriği

```
install-dev-harness.ps1    sıfırdan kurulum (bu doküman)
setup-dev-harness.ps1      kontrol / güncelleme / onarım / store işlemleri
agent-context-budget.ps1   input payload tahmincisi
hooks\                     store'u oturum başında aktifleştiren SessionStart hook'u
skills\narvai-orchestrator\   orchestrator skill'i — TEK DOĞRULUK KAYNAĞI
templates\CLAUDE.md        yeni makinede global CLAUDE.md tohumu
memory\                    proje başına dış store (proje adıyla)
KULLANIM.md                günlük kullanım
KURULUM.md                 bu dosya
notebook.md                ilk kurulumun defteri: ne ölçüldü, ne ölçülmedi
```
