# Spec

Code is not where intent is discovered. For work that touches three or more files or changes a contract, settle the desired behaviour first. A small change needs no spec: the request is the spec unless observable behaviour is ambiguous.

## One owner per work item

Never two sources of truth for one feature. Record the owner in `state.yaml` as `spec_owner`.

| Owner | When |
|---|---|
| short spec inside `state.yaml` | SMALL behaviour change |
| `<store>/work/<id>/SPEC.md` | default for STANDARD and up |
| a document under the docs root | the user reads and edits it as a working document |
| OpenSpec or Spec Kit | only in a repo that already uses one |

The spec does not live in the repository unless the repository already keeps specs there.

## Shape

Short spec:

```
Goal
Behaviour
Acceptance criteria
Non-goals
Constraints
Verification
```

A full spec adds, in proportion to risk: current behaviour, who is affected, data, API and schema effects, error and edge behaviour, compatibility, open decisions. HIGH-RISK adds alternatives, migration and rollback. Implementation detail stays out unless it is itself a constraint.

## When implementation shows the spec is wrong

1. Stop the affected slice.
2. Decide what it is: an implementation detail, a clarification with the same observable behaviour, or a real change of behaviour or scope.
3. Update the spec.
4. If user-visible behaviour, scope, compatibility or architecture changed, ask.
5. Mark the tests and plan assumptions it invalidates.
6. Continue from the updated spec.

Never bend code to satisfy a stale test or a stale plan.

## Closing

Before a non-trivial item is marked done: the spec states the behaviour that was finally accepted, durable requirements and decisions are recorded in the store, the last verification is recorded with its result.
