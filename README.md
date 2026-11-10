# narvai

AI kodlama ajanları (Claude Code, Codex, Pi, varsa Qwen) için geliştirme harness'ı. .NET ve React/Next.js işlerinde
ajanın doğru SDLC ile çalışmasını sağlar: isteğin niyetini okuyup doğru skill'leri seçen yönlendirici
(`narvai-orchestrator`), repo dışında tutulan proje store'u, context ve iş dağıtım kuralları, "done" kapısı
(`verify` + pre-push), davranış eval'leri ve incelenmiş, sabitlenmiş üçüncü parti skill kopyaları.

## Kurulum

Önkoşul: node 22+ ve git.

```
git clone https://github.com/<kullanıcı>/narvai-orchestrator-skill.git narvai && cd narvai
node narvai.mjs install    # config, skill kopyaları, üçüncü parti skill'ler, Claude hook'ları
node narvai.mjs doctor     # ne kurulu, ne eksik
```

Sonra `~/.narvai/config.json`'ı düzenle (`storeRoot`, `docsRoot`, `language`, `evalRepos`) ve her repo için store'daki
`map.json`'a bir satır ekle. Ayrıntı: [KURULUM.md](KURULUM.md), kullanım: [KULLANIM.md](KULLANIM.md).

## Komutlar

| Komut | Ne yapar |
|---|---|
| `install` | config, sync, vendor edilmiş üçüncü parti skill'ler, Claude hook kayıtları |
| `sync` | narvai skill'ini Claude/Codex/Pi/Qwen'e kopyalar, Pi kurallarını üretir, Codex/Qwen pointer'ını yazar |
| `doctor` | kurulu, eksik ya da bayat olanı listeler |
| `usage [--days N]` | hangi skill'lerin gerçekten kullanıldığı |
| `estimate <yollar>` | bir worker'ın okuyacağı şeyin token tahmini; sığar mı, bölünmeli mi |
| `verify [--all] [--hook]` | repo'nun "done" tanımı (store'daki `verify.json` ya da stack varsayılanları) |
| `hooks <repo>` | `verify --hook` koşan pre-push hook'u; mevcut hook korunur ve önce koşar |
| `eval [--only=..] [--dry-run]` | `evals/scenarios.json`'u headless Claude Code ile koşar; yalnız abonelik girişiyle, API anahtarı varsa reddeder |

## Klasörler

- `skills/narvai-orchestrator/`: yönlendirici skill ve referansları (tek kaynak; `sync` kopyalar).
- `hooks/`: `narvai-guard.mjs` (narvai hatırlatması, subagent context sınırı), `store-context.mjs` (store ve iş kalemi,
  sıkıştırma sonrası dönüş), `ua-auto-update.mjs` (commit sonrası kod grafiği).
- `evals/`: davranış senaryoları.
- `third-party/` + `third-party.json`: incelenmiş kopyalar, kaynak repo ve commit'leri, yerel değişiklikler.
- `templates/CLAUDE.md`: kullanıcı kuralları şablonu.
- `*.ps1`: Windows'a özel ek işler (graph, araç kontrolleri); sync node'a devredildi.

## Lisans

`third-party/` altındaki her skill kendi kaynağının lisansını taşır (klasörlerindeki LICENSE dosyaları ve
`third-party.json`). Geri kalanı özel.
