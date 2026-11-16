# State: the store, work items, resume

Chat history is never the handoff. State lives in the store, outside every repository; `narvai context` prints its path. Nothing of the harness is written into a project tree: no state folder, no ignore line, no graph output.

## Layout

```
<store>/
  project-profile.md    derived navigation card
  project-rules.md      the project's rules
  requirements.md       durable, cross-feature product intent
  invariants.md         rules that are easy to forget
  decisions/            ADRs
  work/<id>/
    state.yaml          checkpoint
    SPEC.md             the spec, when the store owns it
    PROGRESS.md         slice table and dated log
```

## state.yaml

```yaml
id: fabric-variant-split
status: implementing        # planning | implementing | verifying | done
size: STANDARD
repo: <absolute repo path>
branch: feat/fabric-variant-split
spec_owner: store-spec
spec_path: <store>/work/fabric-variant-split/SPEC.md
current_slice: persist-variant-colors
next_action: map the handler and run the build
changed_files: [src/Modules/Fabric/...]
verified: { command: "narvai verify", result: passed }
blockers: []
active_slices: { backend-api: claude, frontend-ui: codex }
```

Small and factual. No conversation summary. Update at a finished slice, a pause or a handoff, not after every edit. It is a checkpoint, not a lock: assign disjoint slices before parallel work starts.

## Resume

1. `narvai context` names the open work item for this branch and its `next_action`.
2. Read the spec section of the current slice only.
3. `git status` and a targeted `git diff`.
4. Continue from `next_action`.

If state and git disagree, the repository is right; say what differs. If two open items match the branch, ask which one. Never ask for the previous transcript.

## A new instruction while implementing

Classify it first: clarification, revision, added scope, split, bug in the current work, rollback, inspection, pause. An ordinary revision reuses the current spec and work item: update the spec, mark the plan and test assumptions it makes stale, change the code, verify, update state. A revision the user asked for is already approved.

On rollback, find exactly which changes belong to the rejected direction from git; never assume the whole working diff is yours.

## What to keep

Temporary things are not persisted. Active work goes to `work/<id>/`. Durable product intent goes to `requirements.md`, a decision to `decisions/`, a rule worth remembering to `invariants.md`. Link to a spec, never copy it. Mark superseded rather than deleting.
