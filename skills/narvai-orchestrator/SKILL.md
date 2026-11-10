---
name: narvai-orchestrator
description: Use for any request about code, a repository or its delivery — building, fixing, understanding or analysing, reviewing, planning, researching, documenting, PRs and CI, or resuming work in progress, and whenever the user says "narvai". Reads the intent behind the user's words rather than trigger phrases, picks the skills that fit and tells the user which ones it used. Routes the request to the lightest sufficient workflow, loads project rules, picks one canonical spec owner, enforces context budgets, and keeps cross-harness state in an external per-repo store (never inside the repo). Invoke before planning, before reading the repository broadly, and before dispatching any subagent.
---

# narvai-orchestrator

Router and governor. Not a methodology. Main agent implements by default.

## 0. Read the intent

Work out what the user wants at the end of this turn (knowledge, a change, a decision, an artifact, a
verification, an operation), what it is about, and how heavy it is. Read for meaning, never for keywords;
users type fast, with typos and sometimes without diacritics. Then pick skills by intent →
`references/intent-routing.md`. Every skill you invoke is named to the user in one line with the reason, and the
final answer of the turn ends with one line listing the skills used (narvai-orchestrator included).

**Required skill calls.** For each line that fits the request, call the Skill tool right after this skill and
before reading code for it. Naming a skill or "following its flow" without calling it does not count.
- UI work, a plan for it included (page, dialog, form, component, layout): the design skill named in the project
  profile's `## UI` (read the profile first), then `impeccable`.
- A bug, a failure or a wrong value: `mattpocock-skills:diagnosing-bugs`.
- About to write code: `karpathy-guidelines`.
- An endpoint, DTO, enum or error code changes: read `references/delivery.md`; the plan names all four steps:
  backend first, regenerate the client types, drift check against the schema URL, two PRs in one merge window.

The other checkpoints are in §3b.

## 1. Classify before anything else

Is there an active work item for this branch/worktree?

- **Yes** → read `references/portability.md` (resume + live revision protocol). Do not start a new spec.
- **No** → continue below.

Is the goal knowledge about the code rather than a change? → `references/understand-anything.md`. No spec,
no size gate; the answer is an explanation with `file:line`.

Size the request: TRIVIAL / SMALL / STANDARD / LARGE / HIGH-RISK.
Rules and examples: `references/routing.md`.

## 2. Load only what the size needs

| Size | Load |
|---|---|
| TRIVIAL | project rules → locate → edit → targeted verify. Nothing else. |
| SMALL | + micro-spec, lean review |
| STANDARD | + `project-context.md`, `spec-policy.md`, `review-gates.md` |
| LARGE / HIGH-RISK | + `repo-intelligence.md`, `context-budget.md` |

Read a reference file only when the row above selects it. Never load all of them.

## 3. Fixed gates, every size

- **Project rules win.** `CLAUDE.md` / `AGENTS.md` / `.editorconfig` / the store's `project-profile.md` outrank every generic skill. → `references/project-context.md`
- **Spec before non-trivial code.** One canonical owner per work item. → `references/spec-policy.md`
- **Simplicity ladder before new machinery.** → `references/anti-overengineering.md`
- **Tests follow the local policy, not textbook TDD.** → `references/test-policy.md`
- **Done means verified per stack**, and an API change moves backend and frontend together. There is no
  remote CI by choice, so the local run is the gate. → `references/delivery.md`
- **Noisy command output gets compressed.** → `references/tool-io.md`
- **House rules apply to all code:** `references/house-rules-code.md`, `references/house-rules-frontend.md`

## 3b. Skill checkpoints — fixed points in the flow

A skill that is never loaded is never applied; "always active" alone failed in practice (2026-11-03). At each checkpoint, invoke the skill with the Skill tool **once per work item** (again only after context compaction). User rule since 2026-10-26, made concrete 2026-11-03.

| Checkpoint | Invoke | Size |
|---|---|---|
| Route chosen, no spec exists yet | `agent-skills:spec-driven-development` (revising an existing spec skips it) | STANDARD+ |
| First read of an unfamiliar subsystem | the Understand-Anything graph when the store has `understand/src/.ua/knowledge-graph.json` (`references/understand-anything.md`); else one bounded `graphify` query when the store has `graphify/graph.json` (the SessionStart line names it); else targeted grep → `references/repo-intelligence.md` | STANDARD+ |
| Finding where a symbol is defined, who calls it, its references or implementations, its type | the `LSP` tool first: `csharp-ls` for `.cs`, `typescript-language-server` (with the Next.js plugin from `tsconfig`) for `.ts/.tsx`. Grep is for text, strings, config and other languages, or when LSP returns nothing. C# needs the session opened in the repo that holds the `.slnx`; the first query waits ~90 s for the solution to load (measured 2026-11-11). If LSP is unavailable for a repo, say so | all |
| Before writing code | `karpathy-guidelines`; `ponytail` runs through its SessionStart hook, invoke `ponytail:ponytail` only if that line is missing | all |
| Planning or writing UI (a page, dialog, form, component or layout change), including a plan that only describes it | the design skill named in the project profile, and `impeccable` (its local-install block keeps the project's design system first); the plan or reply shows four lines before any code: the page pattern (archetype), the one primary action, the states (loading, empty, error, no permission), the ~344 px layout; then the done check in `house-rules-frontend.md` rule 12. A one-class visual tweak needs only the project design skill | all |
| Before prose leaves (spec, PROGRESS, PR body, docs, the final summary) | `pstack:unslop` | all |
| A bug, a failure or a wrong value is reported | invoke `mattpocock-skills:diagnosing-bugs` (or `agent-skills:debugging-and-error-recovery`) when the diagnosis starts, before reading code for it; it drives reproduce → root cause → fix | all |
| An endpoint, DTO, enum or error code changes | the plan names all four steps: backend first, regenerate the frontend types, drift check against the schema URL, two PRs in one merge window → `references/delivery.md` | all |
| High-risk or irreversible decision | `agent-skills:doubt-driven-development` | HIGH-RISK |
| All slices done | run the stack's definition of done (`references/delivery.md`) and report the numbers. Then ask "review/test yapayım mı?" (CLAUDE.md, 2026-11-03). On yes: a reviewer with a fresh context, in this tool or another one (`agent-skills:code-reviewer`; tests via `agent-skills:test-driven-development`), never the implementer's context; report findings before fixing. If the change touches auth, permissions, money, personal data, secrets, crypto or input from outside, the question names a security review too: `differential-review`, plus `sharp-edges` for a new API or config surface. For a screen, the question also offers `impeccable` `critique` and `audit` (UX and responsive) | STANDARD+ |

Small UI work (a visual tweak, alignment): no review/test question; update Docker, the user checks the screen.

## 4. Propose the route, then work

First reply to a non-trivial request is compact — understanding, repo, mode, spec owner, flow, context target, one question: devam edeyim mi? No giant plan before route approval.

Then implement in inspectable slices. After a meaningful slice, update the work item's `PROGRESS.md` first: a dated log line (what was done, how the problem was solved, what was fixed, changed files, verification) and the "new structure" section. Then report to the user: what changed, what was verified, what is next. Do not disappear into a long autonomous run.

## 5. Delegation is the exception

Do the work yourself unless the Delegation Gate passes (`references/routing.md#delegation-gate`). Never one agent per file/test/checklist item. Max 5 concurrent, no two on the same file. Ask the user before dispatching.

## 6. Heavy Mode needs approval

Superpowers, pstack `arena`/`swarm`/`architect`/`blast-radius`, repo-wide `ponytail-audit`, Graphify document/media semantic pass, Understand-Anything graph build (`understand`, `understand-domain`), a CodeQL database build or a full Semgrep run, `mutation-testing` campaigns, multi-model fan-out: never automatic. Installing a tool a skill asks for (`semgrep`, `codeql`, `mewt`, `dotnet-trace`, Playwright browsers) is asked first too. Name the cost, get an explicit yes.

## 7. Capability gap

Curated stack first. Only when nothing covers a real need: `references/capability-gap.md`.
