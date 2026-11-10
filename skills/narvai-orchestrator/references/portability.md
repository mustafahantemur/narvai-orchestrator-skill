# Portability — shared state, resume, live revision

Chat history is never the handoff protocol.

## The store lives OUTSIDE the repository

Nothing is written into a project tree: no `.ai/` folder, no `.gitignore` edit, no stray
`graphify-out/`. The store sits in a memory root next to the harness.

All projects share one memory root; each gets a folder **named after the project**:

```
<memory root>/
  map.json                 absolute repo path -> store path
  <project-a>/
  <project-b>/
```

Memory root is `storeRoot` in `~/.narvai/config.json` (`$env:AI_HARNESS_MEMORY` overrides it). A second repo with the same folder name gets a short path-hash suffix;
`map.json` is the authority either way.

**It activates on its own.** A SessionStart hook resolves the working directory against `map.json`
and injects the store path, which files are filled, any active work item and the code-graph path.
If that context is already in the session, use it — do not go looking for the store again. It is
silent outside onboarded repos.

When it is not there (another harness, a subagent, a fresh shell):

```
setup-dev-harness.ps1 -Where <repo path>
```

Never guess the path.

Trade-off to be aware of: this store is not versioned with the repo, so it is not branch-aware
and not backed up by pushing. `state.yaml` records `branch:` — check it matches before resuming.

## Layout

```
<store>/
  index.md              what lives here, one screen
  project-profile.md    derived navigation card
  requirements.md       durable cross-feature intent
  invariants.md         high-value rules that are easy to forget
  decisions/            ADRs
  lessons/              curated reusable findings
  work/<id>/
    state.yaml          durable checkpoint; the SessionStart hook reads `status` and `branch`
    SPEC.md             canonical spec, when the store owns it
    PROGRESS.md         human log: slice table, what the new structure does, dated log
    evidence.tsv        optional, compact
    handoff.md          optional, only when state alone is insufficient
  runtime/              token estimates, locks, session ids
  graphify/             code graph index
```

## state.yaml

```yaml
id: fabric-ocr-variant-split
status: implementing
mode: STANDARD
repo: <absolute repo path>
spec_owner: store-spec
spec_path: <store>/work/fabric-ocr-variant-split/SPEC.md
branch: feat/fabric-ocr-variant-split
current_slice: persist-variant-colors
next_action: implement handler mapping and run targeted backend tests
changed_files: [src/Modules/Fabric/...]
tests: { last_run: "dotnet test ...", result: passed }
blockers: []
active_slices: { backend-api: claude, frontend-ui: codex }
decisions: [ { ref: "<store>/work/fabric-ocr-variant-split/SPEC.md#color-model" } ]
```

Small and factual, ≤ 700-1,000 tokens. No conversation summaries. Update at meaningful checkpoints, pause, handoff or a completed slice — not after every edit.

It is a **durable checkpoint, not a live lock.** Separate worktrees do not share mutations. Assign disjoint slices before launch; one integration owner reconciles against the canonical spec.

## Resume — Claude ↔ Codex ↔ Pi

On `continue` / `resume` / a new harness in the same branch:

1. determine repository and current branch/worktree
2. resolve the external store (`-Where`, or `map.json`), then find the matching active `work/*/state.yaml`
3. read project instructions from the repo + `project-profile.md` from the store
4. read only the spec section for the current slice
5. `git status` and a targeted `git diff`
6. check the last recorded verification still applies
7. continue from `next_action`

Do not re-run full discovery unless state is stale or conflicting. Do not ask for the previous transcript. If state conflicts with git, trust the repository and surface the mismatch. If two active items match one branch, ask for one explicit selection — never guess.

## Live revision while implementing

Classify a mid-work instruction first: clarification · revision · scope-add · scope-split · bug-in-current-work · rollback · inspection · pause/resume.

Ordinary revisions reuse the current spec and work item. Do not spawn a new agent, spec or work item for them.

Revision protocol: pause only the affected slice → compact impact statement → update the requirements ledger if durable intent changed → update the canonical spec first → mark stale plan/test assumptions → revise implementation → targeted verification → update state and next action. Trivial local edits that do not change accepted behavior skip the ceremony.

**A revision the user asked for is already approved.** Do not ask twice unless it introduces a new destructive or high-risk consequence they could not reasonably infer.

## Inspection

```
Done: ...
Changed: file/symbol list
Current diff: short summary
Verified: command/result
Next: ...
Open decision: ...
```

On "show me what you changed": `git diff --stat`, then a targeted diff, then behavior — not a prose summary.

## Rollback

Identify exactly which changes belong to the rejected direction. Never assume the whole working diff is yours — check git evidence. Do not revert unrelated or pre-existing user changes. Update spec and state before starting the new direction.

## Pause / handoff

Persist spec updates, update `state.yaml`, write `handoff.md` only if state alone is insufficient (≤ 400-800 tokens), record the exact next action, changed files, last verification.

## Memory promotion

```
TEMPORARY      -> do not persist
ACTIVE WORK    -> <store>/work/<id>/
PROJECT INTENT -> requirements / spec / ADR / invariant
PROJECT LESSON -> <store>/lessons/
```

Do not persist something merely because it appeared in chat. No transcripts. Link to canonical specs, never copy them. Archive completed work; mark superseded rather than blind-deleting. The hot path stays small after years.

Obsidian is optional, disabled, and never authoritative for project state.

## Writing inside a repository

Only the code the task actually requires. No harness bookkeeping, no `.ai/`, no `.gitignore` line,
no index output. If a tool has no option to write elsewhere, build in a temp location and move the
result into the store — and check `git status` afterwards.
