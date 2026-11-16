# narvai

Türkçe · [English](README.en.md)

Hermes, Claude Code, Codex, Antigravity ve Orca için tek bir geliştirme ortamı. Skill'ler, kurallar ve hafıza tek yerde
durur, her agent aynı dosyaları okur. Hermes içinde Claude ile başlayıp limit dolunca aynı oturumda Codex ile devam
edersin. .NET ve React/Next.js işlerinde `narvai-orchestrator` isteğin niyetini okuyup doğru skill'leri seçer, store'u
repo dışında tutar ve "done" kapısını (`verify` + pre-push) uygular.

## Nasıl çalışır

```
Orca (çalışma alanı, worktree'ler)
  └─ Hermes (tek agent döngüsü, tek oturum)
       ├─ Claude aboneliği    claude CLI üzerinden (DirectSDK plugin'i)
       ├─ ChatGPT aboneliği   Codex OAuth, fallback olarak
       └─ AgentMemory         yerel, ortak hafıza
Claude Code, Codex, Antigravity, Pi: aynı skill'ler, aynı kurallar, aynı hafıza
```

- Her skill'in tek fiziksel kopyası bu repodadır. `~/.claude/skills`, `~/.agents/skills` (Codex),
  `~/.gemini/config/skills` (Antigravity) ve Pi'deki girdiler buraya junction'dır. Hermes `skills.external_dirs` ile
  doğrudan okur.
- Kuralların kaynağı `rules/GLOBAL.md` dosyasıdır. `sync` her agent'ın kural dosyasını buradan üretir ve `{{AI_ROOT}}`
  yerine kurulum kökünü yazar.
- Hafıza AgentMemory'dedir (`http://localhost:3111`, API anahtarı gerektirmez, embedding cihazda hesaplanır). Hermes onu
  native memory provider olarak, diğer agent'lar MCP ile kullanır. Kayıtlar git repo klasörünün adına göre ayrılır.

## Klasör düzeni

Varsayılan kök `C:\Projects\AI`. Kurulumda `-Root` ile değiştirebilirsin.

| Klasör | İçerik |
|---|---|
| `Harness` | bu repo: skill'ler, kurallar, hook'lar, script'ler |
| `Features` | plan, spec, ADR, rapor, artifact ve `_harness` store'u |
| `Memory` | AgentMemory verisi |
| `Worktrees` | Orca'nın açtığı worktree'ler |
| `Apps` | agent uygulama klasörleri (`scripts/move-app-homes.ps1` taşır) |

## Kurulum

Önkoşul: Windows 11, PowerShell 7, node 22+, git ve winget.

```powershell
git clone https://github.com/mustafahantemur/narvai-orchestrator-skill.git C:\Projects\AI\Harness
cd C:\Projects\AI\Harness
.\install-dev-harness.ps1                       # kök C:\Projects\AI
.\install-dev-harness.ps1 -Root D:\AI           # başka bir kök
.\install-dev-harness.ps1 -ClaudeSubscription   # Hermes'in ana modeli Claude aboneliği olur
.\install-dev-harness.ps1 -DryRun               # yalnız planı gösterir
```

Bootstrap eksik olanları kurar, sonra `node narvai.mjs setup` çalıştırır.

| Bileşen | Kaynak |
|---|---|
| Claude Code | npm `@anthropic-ai/claude-code` |
| Codex CLI | npm `@openai/codex` (Codex masaüstü uygulaması kuruluysa onun CLI'ı) |
| Hermes | resmi kurulum betiği `hermes-agent.nousresearch.com/install.ps1` |
| Orca | winget `StablyAI.Orca` |
| Antigravity | winget `Google.Antigravity` |
| AgentMemory | npm `@agentmemory/agentmemory@0.9.33` |
| Pi, uv, RTK, OpenSpec, Spec Kit, Graphify | npm, winget ve uv |

Araçları zaten kurulu bir makinede yalnız bağlantıları kurmak için:

```powershell
node narvai.mjs setup [--root D:\AI] [--claude-subscription] [--dry-run]
```

`setup` her adımı ayrı dener. Yaptığını `OK`, atladığını `SKIP`, elle yapılacak işi `TODO` olarak yazar. Tekrar
çalıştırmak güvenlidir ve değiştirdiği her dosyanın yedeğini `~/.narvai/backups` altına alır.

### setup'ın yaptıkları

- `install --adopt` config'i, skill junction'larını, kural dosyalarını ve Claude hook'larını kurar. Elle yazılmış bir
  kural dosyası bulursa yedekleyip devralır.
- AgentMemory için `.env`'i yazar (cihazda embedding, 8 temel MCP tool'u, veri klasörü, ortak kimlik `shared-dev`),
  oturum açılışında server'ı başlatan zamanlanmış görevi kurar ve server'ı Claude Code, Codex ve Antigravity'ye MCP
  olarak ekler. MCP köprüsü server kapalıysa ayrı bir depoya yazmaz, hata verir (`AGENTMEMORY_FORCE_PROXY=1`).
- Hermes'te Claude ve Codex login'lerini ödünç almayı kapatır, skill klasörlerini ve Claude plugin skill'lerinin
  görünümünü kurar, AgentMemory'yi memory provider yapar ve Context7 MCP'sini ekler. Config'de `adoOrg` varsa Azure
  DevOps MCP'sini yazma tool'ları kapalı olarak ekler. `--claude-subscription` Claude DirectSDK plugin'ini kurar ve ana
  model yapar.
- Codex'te proje talimatı için `CLAUDE.md` fallback'ini açar, Claude içeriğini kopyalayan import sync'ini kapatır.
- Orca kapalıysa varsayılan agent'ı Hermes yapar, Hermes argümanını `--yolo` yerine `--checkpoints` yapar ve
  worktree klasörünü `<kök>\Worktrees` olarak ayarlar.

### Elle yapılacaklar

```powershell
claude                                        # Claude Code'a giriş
codex login                                   # Codex CLI'a giriş
hermes auth add openai-codex --type oauth     # Hermes içinde ChatGPT aboneliği
hermes fallback add                           # Claude limiti dolunca Codex devralır
.\scripts\move-app-homes.ps1 -Apply           # tüm agent uygulamaları kapalıyken
```

Antigravity'yi bir kez açıp Google hesabınla giriş yap.

## Günlük kullanım

| İş | Nasıl |
|---|---|
| Hermes'i Orca'dan aç | Orca'da yeni sekme, agent Hermes |
| Model değiştir | Hermes içinde `/model` |
| Oturuma devam et | `hermes -c` ya da `hermes --resume <id>` |
| Hafızada ara | agent'a sor ya da `memory_recall`, `memory_smart_search` |
| Karar kaydet | `DECISION <ID> \| topic: ... \| decision: ... \| status: current \| date: YYYY-MM-DD \| source: ...` |
| Hafıza sağlığı | `agentmemory status`, görüntüleyici `http://localhost:3113` |
| Skill ekle | klasörü `third-party/skills` altına koy, `third-party.json`'a yaz, `node narvai.mjs install` |
| Kural değiştir | `rules/GLOBAL.md`'yi düzenle, `node narvai.mjs sync` |
| Claude plugin güncellemesinden sonra | `node narvai.mjs setup` |
| Durum | `node narvai.mjs doctor`, `hermes status`, `hermes fallback list` |

Aynı tip ve ID ile kaydedilen karar eskisini supersede eder. Recall yalnız güncel kaydı döndürür.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `setup [--root <dir>] [--claude-subscription] [--dry-run]` | `install --adopt`, ardından Hermes, AgentMemory, MCP, Codex ve Orca bağlantıları |
| `install [--root <dir>] [--adopt]` | config, sync, vendor edilmiş üçüncü parti skill'ler (junction), Claude hook kayıtları |
| `sync [--adopt]` | narvai skill'ini Claude, Codex, Antigravity ve Pi skill klasörlerine bağlar; `rules/GLOBAL.md`'den Claude, Codex, Antigravity, Pi ve Hermes kural dosyalarını üretir; Qwen pointer'ını yazar |
| `doctor` | kurulu, eksik ya da bayat olanı listeler |
| `usage [--days N]` | hangi skill'lerin gerçekten kullanıldığı |
| `estimate <yollar>` | bir worker'ın okuyacağı şeyin token tahmini; sığar mı, bölünmeli mi |
| `verify [--all] [--hook]` | repo'nun "done" tanımı (store'daki `verify.json` ya da stack varsayılanları) |
| `hooks <repo>` | `verify --hook` koşan pre-push hook'u; mevcut hook korunur ve önce koşar |
| `eval [--only=..] [--dry-run]` | `evals/scenarios.json`'u headless Claude Code ile koşar; yalnız abonelik girişiyle, API anahtarı varsa reddeder |

## Repo içi klasörler

- `skills/narvai-orchestrator/`: yönlendirici skill ve referansları.
- `third-party/` ve `third-party.json`: incelenmiş, commit'e sabitlenmiş skill kopyaları (caveman, modern-web-guidance,
  impeccable, dotnet ve diğerleri), kaynak repo ve yerel değişiklikler.
- `rules/`: `GLOBAL.md` ortak kurallar, `hermes-identity.md` Hermes'e özel kimlik ve Claude tool adı eşlemesi.
- `hooks/`: `narvai-guard.mjs` (narvai hatırlatması, subagent context sınırı), `store-context.mjs` (store ve iş kalemi),
  `ua-auto-update.mjs` (commit sonrası kod grafiği).
- `setup.mjs`: `narvai setup`'ın uyguladığı bağlantılar.
- `install-dev-harness.ps1`: yeni makine kurulumu. `scripts/move-app-homes.ps1`: uygulama klasörlerini köke taşır.
- `evals/`: davranış senaryoları. `templates/CLAUDE.md`: kullanıcı kuralları şablonu.

## Bilinen sınırlar

- Hermes'in AgentMemory plugin'i katalogda yalnız Linux ve macOS için listelenir. Windows'ta built-in `MEMORY.md`
  yazımlarının aynalanması POSIX dosya kilidi istediği için çalışmaz. Kayıt, recall, arama ve konuşma yakalama çalışır.
- Hermes'te Claude aboneliği DirectSDK plugin'iyle kullanılır. Plugin değiştirilmemiş `claude` CLI'ını senin login'inle
  çalıştırır. Anthropic'in koşullarını ve Team ya da Enterprise planda şirket politikasını kendin değerlendir.
- Orca açıkken ayar dosyasına yazılmaz. `setup` bunu `TODO` olarak bildirir.
- caveman yalnız sohbet yanıtlarını kısaltır. Kod, commit, doküman ve hafıza kayıtları normal yazılır.

## Lisans

`third-party/` altındaki her skill kendi kaynağının lisansını taşır (klasördeki LICENSE ve `third-party.json`). Geri
kalanı özel.
