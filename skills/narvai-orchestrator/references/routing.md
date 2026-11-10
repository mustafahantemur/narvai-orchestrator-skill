# Routing

## Sizing

**TRIVIAL** — typo, static text, CSS spacing, obvious rename, one-line mechanical edit.
Flow: project rules → locate → edit → targeted verify.
No spec framework. No subagent. No architecture analysis. The request itself is the spec unless observable behavior is ambiguous.

**SMALL** — small bug, small clear CRUD behavior, a few tightly related files.
Flow: project rules → targeted inspect → micro-spec → short plan → implement → stabilize → lean review → simplify.
No persistent spec, no Heavy Mode. Main agent owns the whole loop.

**STANDARD** — a real feature, frontend + backend, API + UI, several related components, meaningful domain behavior.
Flow: project-aware discovery → canonical spec (store `SPEC.md`, `spec-policy.md`) → short plan → approval → implementation slices → stabilization tests → proportionate review → simplify → verify against spec.

**LARGE** — several modules, a subsystem, a long-running feature, a multi-slice migration/refactor.
Flow: bounded discovery → canonical spec → architecture only where necessary → roadmap/slices → approval → bounded worker sessions → artifact handoffs → integration → stabilization tests → review → convergence.

**HIGH-RISK / ARCHITECTURAL** — auth/security, data-loss migration, breaking public API, foundational redesign.
Flow: bounded discovery → full spec (store `SPEC.md` with every section of `spec-policy.md`) → alternatives/tradeoffs → lean impact gate → migration + rollback → acceptance criteria → explicit approval → slices → strong verification → independent review.

When two sizes are plausible, pick the smaller and escalate on evidence. Ceremony that the change does not need is waste.

## Delegation gate

Before spawning any worker, answer these:

1. Can the main agent finish this faster than preparing and reading the handoff?
2. Does the task need substantial independent reasoning, or genuine parallelism?
3. Is it independently verifiable, with clear file/subsystem ownership?
4. Does delegation cut wall-clock time or add real review independence, enough to pay for its context cost?
5. Does the slice fit one worker (`narvai.mjs estimate` says "fits" for what it reads; mechanical bulk edits go through a script)? If not, split it first (`context-budget.md`).

**#1 yes and the rest not strongly justified → DO NOT DELEGATE.**

**Exception, coordinator context (user, 2026-11-04):** when the work item spans several flows or more than ~4 slices, the main agent does not implement them itself. Each flow goes to workers with a bounded brief (flow SPEC + PLAN paths, owned files, build command, commit rule), sequentially or in parallel on disjoint files; a flow bigger than one worker's budget is split first (`context-budget.md`, "Sizing a worker before dispatch"). The coordinator keeps spec, `state.yaml`, integration build, commits and Docker. Context growth in the main session is a cost to weigh in #1, not only wall-clock.

Worker budgets: TRIVIAL 0 · SMALL 0 (1 exceptional) · STANDARD 0-2 · LARGE ≤3 · HIGH-RISK only with an explicit budget.

Parallel work requires disjoint slices, separate worktrees/branches when writing, explicit ownership recorded in `state.yaml` as `active_slices`, a shared canonical spec, and per-slice checkpoint state. Two writing agents never own the same files.

`state.yaml` ownership is **planned ownership at dispatch time**, not a live lock. Separate worktrees do not share file mutations.

Ask the user before dispatching, and name why.

## Harness choice

Claude, Codex and Pi are interchangeable execution harnesses over the same spec and state.

- Implementation: whichever session is already open.
- Independent review: a fresh context; same tool or another one (`review-gates.md`).
- Pi suits bounded quick slices, fresh low-context continuation, narrow verification.
- Orca: worktree isolation, launching/resuming a harness, truly disjoint parallel slices. Not agent races, not consensus, not fan-out.

Do not force a harness into a task merely because it is installed.
