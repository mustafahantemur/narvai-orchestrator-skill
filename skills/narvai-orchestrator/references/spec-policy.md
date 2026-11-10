# Spec policy

Code is not where product intent is discovered. For every non-trivial change, establish desired behavior first.

## One canonical owner per work item

Never keep two competing sources of truth for the same feature. Pick one, record it in `state.yaml` as
`spec_owner`.

| Owner | When |
|---|---|
| **micro-spec** (inside `state.yaml`) | TRIVIAL / SMALL behavior change; a persistent framework would be waste. Target ≤ 400-700 tokens. |
| **store spec** (`<store>/work/<id>/SPEC.md`, `spec_owner: store-spec`) | Default for STANDARD / LARGE / HIGH-RISK work. |
| **Features doc** (`<docsRoot>/<project>/<topic>/<item>/SPEC.md`, `docsRoot` from `~/.narvai/config.json`, `spec_owner: features-doc`) | When the user reads and edits the spec as a working document, or analysts share it. |
| **OpenSpec / Spec Kit** | Only in a repo that has adopted them (an `openspec/` or `.specify/` folder). |

HIGH-RISK work (auth, data-loss migration, breaking contract) gets the fuller spec shape below, whichever owner
holds it. The spec never lives in the repo unless the repo already keeps specs there.

## What a spec answers

Proportionally to size: problem/goal · current behavior when relevant · desired behavior · actors affected · in scope · explicitly out of scope · project constraints · requirements · acceptance criteria · compatibility · data/API/schema effects · error and edge behavior · verification strategy · unresolved decisions.

Keep implementation detail out unless it is itself a constraint. Depth scales with uncertainty, blast radius and durability — not with the mere existence of a code change.

## Micro-spec shape

```
Goal
Behavior
Acceptance criteria
Non-goals
Constraints
Verification
```

## Spec drift protocol — mandatory

Implementation must not silently redefine the feature. When implementation shows the spec is wrong or incomplete:

1. stop the affected slice
2. classify: implementation detail only / clarification with same observable behavior / real behavior or scope change
3. update the canonical spec at the right level
4. if user-visible behavior, scope, compatibility or architecture meaningfully changed → ask for approval
5. mark obsolete tests and plan assumptions stale
6. continue from the updated spec

Never distort code to satisfy a stale test or a stale plan.

## Requirements ledger

The store's `requirements.md` holds durable, cross-feature product intent only:

```
R-042 — Fabric variant may contain multiple colors
Status: accepted | exploring | superseded
Related spec: <store>/work/<id>/SPEC.md#...
Notes: durable product intent only
```

Feature-local acceptance criteria stay in the canonical spec. Do not mirror every spec requirement here. Mark superseded rather than deleting.

## Closing a work item

Before marking a non-trivial item complete: sync final accepted behavior back into the canonical spec, persist only durable requirement/decision changes, record final verification, archive the volatile work state.
