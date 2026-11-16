---
name: narvai-orchestrator
description: Use for any request about code, a repository or its delivery, and whenever the user says "narvai": building, fixing, understanding, reviewing, planning, documenting, PRs, resuming work in progress. Sizes the work, runs it through the lifecycle (define, plan, build, verify, review, ship), keeps state outside the repo, and loads only the skills the moment calls for.
---

# narvai-orchestrator

A lifecycle and a small set of commands. The commands do the mechanical part; you do the judgement. Project rules always outrank this file.

## 1. Start

Run `narvai context`. It prints the rules that apply, the stacks, the checks, the store path and any open work item with its next action. If a work item is open on this branch, continue it from `next_action` (`references/state.md`); do not start a new one.

Read the intent, not the keywords: what does the user want at the end of this turn (knowledge, a change, a decision, a document, a verification)? If the goal is knowledge about the code, answer from the source with search and the language server and cite `file:line`. No spec, no size gate.

## 2. Size the work

Pick the smaller size when two fit; move up on evidence.

| Size | What it is | Phases |
|---|---|---|
| TRIVIAL | typo, text, spacing, one-line mechanical edit | build, verify |
| SMALL | small bug, a few closely related files | build, verify, self-review |
| STANDARD | a feature, backend and frontend, an API and its screen | define if unclear, plan, build in slices, verify, review |
| LARGE | several modules, a long-running feature | as STANDARD, with slices handed to workers |
| HIGH-RISK | auth, data-loss migration, breaking contract | as LARGE, with rollback and explicit approval |

For STANDARD and up the first reply is short: what you understood, the size, where the spec lives, the slices, one question. No long plan before the route is accepted.

## 3. Lifecycle

At each moment run `narvai next --event <name> [--paths ...]` and read only the skill files it prints. The owner of each phase is a skill of the agent-skills set; stack, UI, security and simplicity skills attach to a phase. The user's rules override a skill wherever they disagree (when tests are written, when to commit, how much ceremony a small task gets).

| Phase | When | Event | You also do |
|---|---|---|---|
| Define | the request is unclear, or the work is large | `unclear`, `idea` | one question at a time, your best guess attached |
| Plan | three or more files, or a contract change | `plan` | one spec owner (`references/spec.md`); record it in the work item |
| Build | every change | `build`, `edit`, `library`, `refactor`, `migrate` | smallest change that works; follow the patterns already in the code |
| Verify | every change | `failure`, `tests`, `perf`, `done` | `narvai verify`; `narvai tests`; `narvai contract` when an endpoint, DTO or enum changed |
| Review | at `done` (self-check) and when the user accepts a review | `done`, `review`, `prose`, `decision` | a reviewer with a fresh context for STANDARD and up (`references/review.md`) |
| Ship | the user asks for a commit, push or PR | `ship` | the user's commit rules |

After a meaningful slice, update the work item (state and progress log) before you report: what changed, what was verified with its numbers, what is next.

## 4. Delegation

Do the work yourself unless all of these hold: the part is independent, it is verifiable on its own, it owns its files alone, and reading the handoff costs less than doing it. Never one agent per file or per test. Two writers never share a file.

Profiles: `narvai-kesif` (read-only search, cheap model), `narvai-uygula` (implementation with project rules), `narvai-gozden-gecir` (fresh-context review). A brief names the goal, the files owned, what is already ruled out and what done looks like; it never retells the conversation. Workers report findings, paths and numbers.

## 5. Needs the user's yes first

Multi-agent fan-out, repo-wide audits, a model-built knowledge graph, a document or media pass of Graphify, browser automation runs, installing a tool, any paid provider call.

## 6. References

Read one only when its row applies.

- `references/state.md`: the store, the work item files, resume and live revision.
- `references/spec.md`: spec owners, the short spec shape, what to do when implementation shows the spec is wrong.
- `references/review.md`: who reviews what, what the reviewer gets, the impact check, the output shape.
- `references/graphs.md`: the optional code graphs and when they are worth a query.
