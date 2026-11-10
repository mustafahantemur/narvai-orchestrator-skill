# Capability gap — AAS Core

The curated stack is authoritative. AAS is a gap resolver, never a project orchestrator, never a per-task skill-selection ceremony.

## Curated stack — check here first

| Need | Covered by |
|---|---|
| lifecycle, spec, planning, review, shipping | Addy `agent-skills` |
| engineering principles, evidence, prose cleanup | pstack (`unslop`, `how`, `show-me-your-work`, `figure-it-out`, `principle-*`) |
| simplicity / anti-overengineering | Ponytail |
| repository structure | Graphify + LSP |
| command output | RTK |
| external library facts | Context7 |
| spec artifacts | OpenSpec, Spec Kit |
| worktrees, harness switching | Orca |

If any row covers the need, stop. No AAS.

## Only on a real gap

```
name the missing capability
-> confirm nothing in the table above covers it
-> bounded AAS search
-> inspect at most 3 candidates
-> select at most 1 skill
-> preview / validate
-> user approval if it changes shared or project state
-> pin exact identity and version
```

Invocation is on-demand and local — no permanent always-on MCP:

```
npx agentic-awesome-skills --skills <name> --dry-run
npx agentic-awesome-skills audit --skills <name>
```

Record the pinned selection in the store's `aas-stack.json` with name, version and source.

## Never

- install the whole catalog
- put secrets or private source text in a selection query
- delay an ordinary task with AAS when the curated stack already covers it
- let additions accumulate forever — remove unused ones periodically

## Heavy Mode components

These exist but are never on the default route. Each needs an explicit yes, and you state the extra time, context and agent cost first:

- **Superpowers** — installed but disabled. Turn on with `claude plugin enable superpowers@claude-plugins-official` (or `setup-dev-harness.ps1 -HeavyMode On`), then restart the session. Propose only for foundational subsystem creation, major architecture replacement, large high-risk migration, deeply uncertain design where several independent plans have real value, or unusually large autonomous execution. Say why Addy + canonical spec + one fresh reviewer is insufficient.
- **pstack `arena`, `swarm`, `architect`, `blast-radius`, `thermo-nuclear-code-quality-review`** — multi-model fan-out. Use the lean design and impact gates in `review-gates.md` instead.
- **pstack `why`** — off by default; only when historical design intent matters and cannot be read from current code, spec or tests. Scope the evidence sources narrowly.
- **`ponytail-audit`** — repo-wide, explicit maintenance only.
- **Graphify document/media semantic pass** — token-heavy; code-only is the default.

pstack's own SessionStart auto-routing hook is off (`~/.claude/pstack-models.md`, `~/.codex/pstack-models.md`: `session hook: off`). One orchestrator, one canonical spec. Do not let a second tool re-plan the same work.
