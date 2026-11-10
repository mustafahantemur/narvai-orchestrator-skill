# Review gates

Review is proportionate to risk and prefers a **fresh context** when independence is worth its cost.

## Routing

| Size | Review |
|---|---|
| TRIVIAL | main-agent self-check |
| SMALL | main-agent review + targeted verification |
| STANDARD | fresh reviewer only when the change crosses important layers or contracts, touches persistence/migrations/security, or has unclear impact |
| LARGE / HIGH-RISK | one fresh independent reviewer expected |

Independence means a fresh context, not a different tool (user, 2026-11-11). A zero-context agent in the same
tool is fine; another tool (Claude implemented → Codex reviews) is fine too and adds a second model's view.
What is never fine: the implementer's own context reviewing its own work.

One reviewer. Multiple reviewers only on explicit Heavy Mode request or exceptional risk. Reviewer context target ≤ 25-30k; split a very large diff by accepted slice rather than feeding the whole repository.

## What the reviewer gets

project rules/profile · canonical spec acceptance criteria · current slice and state · diff and changed files · the direct callers/references needed for impact · relevant tests and results.

**No implementation chat history.**

## Gates

- **A — Spec compliance.** Does behavior match the current canonical spec? Any silent scope or behavior drift?
- **B — Project compliance.** Repository architecture and conventions followed? A new pattern where an existing one should have been used?
- **C — Correctness.** Errors and edge cases, nullability and types, transaction/lifecycle/concurrency where relevant, backwards compatibility.
- **D — Impact.** Run the lean impact gate below.
- **E — Tests and evidence.** Is the final accepted behavior protected? Were the test commands actually run? Runtime check where needed?
- **F — Simplicity.** Ponytail ladder; `ponytail-review` when the diff is non-trivial or introduced abstractions or dependencies; Addy `code-simplification` only if structural cleanup still remains. → `anti-overengineering.md`
- **G — Persisted prose.** `pstack:unslop` on specs, plans, ADRs, handoffs, PR descriptions and user-facing technical docs. Style only — it must not alter acceptance criteria, requirements, decisions or technical meaning. Review its diff before accepting.

## Lean design gate — before coding, STANDARD+

Verify only: owner module/layer · caller-callee contract · data shape · error and edge behavior · compatibility · the existing pattern to follow. Use LSP + current source + project rules.

Produce **one** preferred design, plus a one-line note on a material alternative if one genuinely exists. No architecture bakeoff without explicit approval.

## Lean impact gate — instead of blast-radius

1. inspect changed public types and contracts
2. for STANDARD+ or unclear impact, query the Graphify code graph narrowly around the changed symbols
3. confirm with LSP references/callers
4. targeted search for configuration, serialization and persistence coupling
5. inspect directly relevant tests
6. name the one or two assumptions that make the change safe
7. **prove those assumptions** in code or tests

Output stays compact:

```
Affected: ...
Unaffected because: ... [evidence]
Risk: ...
Required verification: ...
```

## Reviewer output

```
PASS | NEEDS FIXES
Blocking findings: ...
Tests/evidence: ...
Residual risk: ...
```

No review essay.
