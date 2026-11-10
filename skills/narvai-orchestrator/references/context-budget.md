# Context budget

## Who manages context

**Main agent: the tool does, with no narvai limit.** Claude Code, Codex, Pi and Ollama-based tools compact or
truncate by their own rules and settings; narvai sets no threshold for the main agent and overrides none of
theirs (user, 2026-11-11).

**Subagents: narvai's limit applies.** In Claude Code the `narvai-guard.mjs` hook reads each subagent's live
context from its transcript and injects one line: at 200K "finish from the evidence you have", at 300K "stop and
return your findings" (`subagentWarn` / `subagentReturn` in `~/.narvai/config.json`). A subagent obeys at once.
**Other tools (Codex, Pi, Qwen, Ollama-based ones) are free to work their own way.** narvai sets them no
context or subagent limit and changes none of their settings; the habits below are suggestions there. The one
thing asked of every tool is the handoff note in PROGRESS.md at a natural stopping point, so another tool or a
new session can pick the work up.

Why: accuracy falls as input grows even on simple tasks, and faster when distractors resemble the target
(Chroma "Context Rot", 18 models, 2025); facts in the middle of a long input are used worst (Liu et al.,
"Lost in the Middle"); how much depends on the model, and advertised windows exceed effective ones. Anthropic's
answer is the smallest set of high-signal tokens: compaction, notes kept outside the context, subagents for
exploration, just-in-time retrieval ("Effective context engineering for AI agents"). Fixed token thresholds
are not part of it.

What narvai asks of the main agent is what makes the tool's compaction safe and cheap:

- **Exploration that reads many files goes to a subagent** (ask first): its reads stay in its own context and
  only the summary comes back.
- **A new, unrelated task starts from a fresh context** (`/clear` or a new session) rather than on top of the
  old one; suggest it once when the topic changes, the user decides.

- **Handoff at every slice boundary.** The work item's PROGRESS.md holds what is done, the next action, open
  questions and changed files, so a compaction or a new session loses nothing.
- **After a compaction, resume from PROGRESS.md**, not from what the summary happens to remember.
- **Long context costs tokens on every turn and loses precision.** Keep it small: narrow slices, targeted reads,
  no broad repo dumps, noisy output compressed (`tool-io.md`).
- **When the tool says context is long, or answers start to drift,** finish the current action, check the
  handoff, and continue the way the tool provides. Never ask the user to type a command the tool runs itself.
- **The tool's own levers carry the rest** (Claude Code): `# Compact instructions` in the user `CLAUDE.md` says
  what a compaction keeps; a `compact` SessionStart hook points back to the branch's work item; the store hook
  names only that work item, not every open one (similar-looking items are distractors); specialist skills are
  `name-only` in `skillOverrides`, since the skill listing is capped (1% of the window) and drops descriptions
  of the least-used skills first.
- A number computed locally is an estimate (`agent-context-budget.ps1`), quoted as "estimated".

## Sizing a worker before dispatch

A worker must be able to finish well under the 300K line, so it is sized when it is dispatched, not stopped
when it gets there. Measured 2026-11-11 over 278 subagents (60 days): a subagent starts at ~53K (median) before
its task; peaks were median 215K, p90 473K, and 89 went past 300K. The briefs were too wide.

Plan each worker to finish near **150K**: the ~53K start, **≤ 60K of reads**, the rest for edits and command
output. Twice the headroom to 300K covers a ±25% estimate and what the worker discovers on the way.

1. List what the worker must read and run `node <harness>/narvai.mjs estimate <paths>` (or `--diff[=ref]`).
   It prints the estimate and "fits" or "SPLIT the slice" against `workerReadBudget` (60K, `~/.narvai/config.json`).
2. Size by tokens, not by file count: what the worker reads plus the size of what it writes. A 200-file change
   is normal for a work item. A mechanical one (rename, import move, i18n keys, a pattern swap) goes through one
   script or codemod run, whose diff is checked with `git diff --stat` and a sample, not by reading every file;
   that costs a few K whatever the file count. Hand-written changes across many files are split by module or
   folder so each worker stays inside the budget.
3. Over budget → split before dispatching: by module or folder, by file group, or by phase (one worker reads and
   writes findings to a file, the next implements from that file). Split workers run one after another on the
   same item; each gets the previous one's result path, never its transcript.
4. The brief states the read budget. The runtime guard (200K / 300K) stays as the backstop, not the plan.

The main agent has no such limit: the user keeps talking to it while workers run.

## Worker dispatch envelope

The dispatch message itself is **≤ 200 tokens, hard**. If a worker cannot be dispatched safely inside 200 tokens, do not stuff more context into the prompt: narrow the slice, persist an artifact and reference it, or keep the work in the main agent.

A dispatch contains only:

- objective
- acceptance criterion
- in scope / out of scope
- exact starting files or spec path
- allowed verification commands
- context/read budget
- required output or state update

Never embed source code, spec bodies or the parent transcript. Pass paths.

The worker returns a condensed result: findings with `file:line`, decisions, what is still open. Never its
transcript or file dumps; the parent's context grows by the summary only.

## Per-worker context contract

The first hop is bounded too, so a short dispatch cannot trigger a 100k rediscovery run:

- start from the exact referenced symbols/files
- at most a few targeted Graphify/LSP/search operations before acting
- workspace-wide exploration is forbidden by default
- a worker never regenerates the repo graph or reads a full graph report unless that is its stated objective
- pull additional files only when a specific unresolved question justifies them

Initial code context normally well below 20k.

## Memory retrieval budget

Lazily retrieved, never preloaded. TRIVIAL/SMALL ≤ 2-4k · STANDARD ≤ 4-8k · LARGE/HIGH-RISK ≤ 8-15k. Search first, then read only the selected items. Never load all decisions, all lessons or all requirements.
