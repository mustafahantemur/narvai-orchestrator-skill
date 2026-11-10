# Agentic Dev Harness v4.0 — kurulum defteri

Kaynak doküman: `C:\Projects\agentic-dev-harness-install.md` (2428 satır)
Başlangıç: 2026-09-22 · FAZ 1-6 tamam

## Sıradaki adım
Kurulum bitti. Kalanlar kullanıcı kararına bağlı:
1. Codex/Pi'de gerçek bir resume denemesi (model çağrısı gerektirir → onay lazım).
2. `memory\` klasörünü yedekleme planı (repo ile versiyonlanmıyor).
3. İsteğe bağlı: Orca üzerinden Claude/Codex/Pi worktree denemesi.
4. Küçültülmüş `CLAUDE.md` kullanımda denenecek; kötü gelirse yedekten uzun sürüm geri döner.

---

## FAZ 1 — envanter ✅ · FAZ 2 — kaynak doğrulama ✅

Detay bu dosyanın git geçmişi yerine aşağıdaki kurulu-sürüm tablosunda.

## FAZ 3 — kurulum ✅

| Bileşen | Sürüm | Kaynak | Not |
|---|---|---|---|
| Claude Code | 2.1.278 | zaten kurulu | — |
| Codex CLI | 0.153.4 | OpenAI Codex app | PATH shim yazıldı: `%APPDATA%\npm\codex.cmd` (hash'li bin dizinini dinamik bulur) |
| Pi | 0.87.0 | npm `@earendil-works/pi-coding-agent` | yeni kuruldu |
| Orca | 1.4.205 | dokunulmadı | — |
| OpenSpec | 1.13.1 | npm `@fission-ai/openspec` | yeni |
| Spec Kit | specify 1.0.10.dev0 @ b9e7389 | `uv tool install specify-cli --from git+github/spec-kit` | yeni |
| Graphify | 0.9.65 | `uv tool install graphifyy` (PyPI adı geçici) | skill claude+codex+pi'ye kuruldu |
| Ponytail | 4.10.0 | `DietrichGebert/ponytail` marketplace | claude + codex |
| pstack | 0.9.36 | **fork:** `michael-denyer/pstack-claude` (kullanıcı onayladı; upstream `poteto/pstack` 404) | claude + codex |
| RTK | 0.48.0 | `winget rtk-ai.rtk` | **hook YOK**, explicit `rtk <cmd>` modu |
| uv | 0.12.17 | winget `astral-sh.uv` | Spec Kit + Graphify ön koşulu |
| Addy agent-skills | claude: plugin açıldı · codex: 0.6.10 zaten enabled | `addyosmani/agent-skills` | §9 |
| Superpowers | 6.3.0 kurulu, **disabled** | claude-plugins-official | Heavy Mode; `-HeavyMode On` ile açılır |
| AAS Core | kurulum YOK (tasarım gereği) | `npx agentic-awesome-skills` | on-demand |
| Obsidian | kurulmadı | — | §31 varsayılan kapalı |

### Politika anahtarları
- `~/.claude/pstack-models.md` + `~/.codex/pstack-models.md` → `session hook: off`.
  pstack'in SessionStart'ta enjekte ettiği `poteto-mode` auto-routing mandate'ı kapatıldı (§34: tek orchestrator).
- Superpowers plugin disabled → SessionStart "You have superpowers" mandate'ı artık gelmiyor (§17).
- RTK hook kurulmadı → Orca'nın settings.json hook zinciri bozulmadı.

### Yedekler
`~/.claude/backups/harness-setup-20260922-111821/` → settings.json, CLAUDE.md (16.261 byte eski hâli), codex config.toml, codex AGENTS.md.

## FAZ 4 — orchestrator ✅

Kaynak: `~/.claude/skills/dev-orchestrator/` → SKILL.md + 13 reference dosyası.
Sync hedefleri: `~/.codex/skills/dev-orchestrator/`, `~/.pi/agent/skills/dev-orchestrator/`.
Divergence: `sync-manifest.json` (dosya başına SHA256), `-Sync` çalıştırınca sapan dosyayı isimle uyarıyor — test edildi, `repo-intelligence.md` sapmasını yakaladı.

`~/.claude/CLAUDE.md` küçültüldü: 16.261 → 5.901 byte. Coding/Frontend/lessons blokları
`references/house-rules-code.md` ve `house-rules-frontend.md`'e **birebir** taşındı.
`~/.codex/AGENTS.md` sonuna orchestrator pointer eklendi (mevcut içerik korundu).

## FAZ 4b — store repo dışına taşındı (kullanıcı isteği)

`.ai/` artık proje ağacında DURMUYOR. `.gitignore`'a hiçbir şey eklenmiyor.
Store kökü: `$env:AI_HARNESS_MEMORY` ?? `<script dizini>\memory`.
Klasör adı **proje adı** (`omnimind_core`, `omnimind_core_frontend`); aynı adlı ikinci repo kısa yol-hash eki alır.
`memory\map.json` repo yolu → store eşlemesini tutuyor, `-Where` yazdırıyor.

`graphify update`'in `--out` bayrağı yok, hep `<path>\graphify-out` yazıyor. Bu yüzden repo'ya
doğrudan çalıştırılmıyor: `-Graph` sarmalayıcısı üretiyor, store'a taşıyor, sonra `git status`
kontrol ediyor. Yarıda kesilen bir çalıştırma repo'da `graphify-out/` bırakabiliyor — sarmalayıcı
`finally` ile temizliyor ve bir sonraki çalıştırmada üzerine yazmayı reddediyor.

Orchestrator referansları (portability, project-context, repo-intelligence, spec-policy,
capability-gap, SKILL.md) ve global CLAUDE.md bu modele göre güncellendi.


## FAZ 4c — otomatik aktifleşme ✅

SessionStart hook: `hooks\ai-store-context.cmd` → `ai-store-context.ps1`. Çalışan dizini
`map.json` ile eşleştiriyor; eşleşirse store yolu, dolu dosyalar, açık iş kalemi (status+branch) ve
graph yolunu `additionalContext` olarak veriyor, eşleşmezse `{}` basıyor.
Ölçülen: eşleşen ~520 ms, eşleşmeyen ~440 ms (timeout 10 sn).

`settings.json`'da Orca'nın SessionStart girdisinin **yanına** eklendi; 13 hook noktası ve 19 Orca
referansı korundu. `-StoreHook On|Off` ile yönetiliyor. Yedek: `backups\harness-hook-20260922-121617`.

İki hata yakalandı ve düzeltildi:
1. Hook stdin okuyordu (`[Console]::In.ReadToEnd()`) → pipe kapanmayınca kilitleniyordu. Stdin
   tamamen kaldırıldı; `CLAUDE_PROJECT_DIR` + `Get-Location` yetiyor.
2. `Split-Path 'C:' -Parent` → `'C:\'` döndürüyor, ben de `'C:'`e trim'liyordum: sürücü kökünde
   sonsuz döngü. Guard trim'lenmiş formları karşılaştırıyor + 64 derinlik sınırı var.
## FAZ 5 — script'ler ✅
- `C:\Users\SS\Documents\dev-harness\setup-dev-harness.ps1` — `-Check -Install -Update -Repair -Sync -Project <path> -Where <path> -Graph <path> -HeavyMode On|Off -RtkHook On|Off`
- `C:\Users\SS\Documents\dev-harness\agent-context-budget.ps1` — input payload estimator (live context DEĞİL)

Yakalanan hata: PowerShell'de `$args` otomatik değişken; `Get-ToolVersion([string]$exe,[string[]]$args)`
imzası tüm version probe'larını bozuyordu (node "MISSING" görünüyordu). `$verArgs`'a çevrildi.
Ayrıca `Use-LocalBin` artık PATH'i registry'den tazeliyor — winget kurulumları stale session PATH'inde görünmüyordu.

## FAZ 6 — dry-run sonuçları ✅ (ölçülen / ölçülmeyen ayrımı raporda)

Ölçülen:
- Graphify code-only: 55 dosyalık .NET modülü kopyası → 250 node / 406 edge, **5 sn**, LLM çağrısı yok
  (`graphify update <path> --no-cluster`). `query --budget 500` kestiğini söyleyerek 87 node'dan 14'ünü verdi.
- RTK: `rtk dotnet build <küçük csproj>` 436 → 65 char (**%85**). `rtk gain`: 3 komutta %62.4.
  **`rtk git log --stat`'ta kazanç SIFIR** (142.938 → 143.015 char) — RTK her komutta işe yaramıyor.
- AAS: `npx agentic-awesome-skills --help` çalıştı, kurulum gerektirmedi.
- Sync divergence tespiti: çalışıyor.
- Dış store: `-Graph` sarmalayıcısı graph'i üretip store'a taşıdı, iki repoda da `git status` boş kaldı.
  Backend 51.944 node / 130.545 edge, frontend 10.110 node / 31.739 edge. Dış store'dan `--graph` ile bounded query çalıştı.

Ölçülmeyen (model çağrısı gerektirir → kullanıcı onayı lazım, para/kota harcar):
- Codex veya Pi'de gerçek resume/handoff (dry-run F, G, K, M).
- Orca üzerinden çok-worktree senaryosu (dry-run S).
- Codex/Pi'nin skill'i gerçekten yükleyip yüklemediği: dosyalar keşif yolunda duruyor ama
  ikisinde de model çağırmadan skill listeleyen komut yok.

## Repo durumu — REPO TEMİZ, COMMIT YOK
`omnimind_core` ve `omnimind_core_frontend`: `git status` boş. `.ai/` ve `.gitignore` değişiklikleri kullanıcı isteğiyle geri alındı; store repo dışına taşındı.
Solution/csproj/package.json değişmedi.

## FAZ 7 — Belgeler'e taşındı + sıfırdan kurulum paketi ✅

Harness `C:\Projects\dev-harness` → `C:\Users\SS\Documents\dev-harness`.
Güncellenenler: `map.json` store yolları, `settings.json` hook yolu (JSON geçerliliği doğrulandı),
CLAUDE.md, KULLANIM.md, notebook, orchestrator reference'ları. Eski yol kalmadı.

Yapısal değişiklik: orchestrator skill'inin **tek doğruluk kaynağı** artık
`C:\Users\SS\Documents\dev-harness\skills\dev-orchestrator`. Claude da Codex ve Pi gibi bir sync hedefi — üçü de kopya alıyor.
Önceden kaynak `~/.claude` idi, bu makineye bağımlıydı ve taşınabilir değildi.

Yeni dosyalar:
- `install-dev-harness.ps1` — sıfır makine bootstrap. `-DryRun`, `-SkipTools`, `-MemoryRoot`.
  Önkoşul kontrolü (pwsh7/winget/git/node), harness'lar, araçlar, graphify skill'i, CLAUDE.md
  tohumlama (varsa dokunmuyor, yalnız pointer ekliyor + .bak), sonra `setup -Install` ve
  `-StoreHook On`. Sonda elle yapılacaklar listesi basıyor.
- `KURULUM.md` — sıfırdan kurulum dokümanı.
- `templates\CLAUDE.md` — yeni makine için global CLAUDE.md tohumu, makineye özgü yol
  `<dev-harness>` ile değiştirilmiş.

`-DryRun` koşuldu, tüm adımlar beklenen şekilde raporlandı. Dört script'in de syntax'ı geçerli.

### Pi hakkında ölçülen
Pi masaüstü uygulaması değil, terminal CLI/TUI. `orca account add` yalnız Claude ve Codex hesabı
yönetiyor — Pi orada yok. Orca terminal pane'inde Pi çalışır mı denenmedi, iddia edilmiyor.
