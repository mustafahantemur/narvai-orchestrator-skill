# Review

Review is proportionate to risk. The implementer's own context never reviews its own work beyond a self-check.

| Size | Review |
|---|---|
| TRIVIAL | self-check |
| SMALL | self-check and targeted verification |
| STANDARD | a fresh reviewer when the change crosses layers or contracts, touches persistence, migrations or security, or its impact is unclear |
| LARGE, HIGH-RISK | one fresh independent reviewer |

Independence means a fresh context: a zero-context agent in the same tool, or another tool. One reviewer; more only when the user asks.

## Self-check at `done`

`narvai next --event done` names the skills: an over-engineering pass on the diff, a code-slop pass, and AI tells out of every text the change adds. Then `narvai verify` and `narvai tests`.

## What the reviewer gets

Project rules, the spec's acceptance criteria, the diff and changed files, the direct callers needed to judge impact, the verification results. No implementation chat history.

## What the reviewer checks

- **Spec:** behaviour matches the current spec; no silent change of scope.
- **Project:** the repository's architecture and conventions; no new pattern where one exists.
- **Correctness:** errors, edges, nullability, transactions, concurrency, compatibility.
- **Impact:** changed public types and contracts; references through the language server; configuration, serialisation and persistence coupling; the one or two assumptions that make the change safe, proven in code or tests.
- **Evidence:** the checks were actually run; accepted behaviour is protected by a test where the project's test rules ask for one.
- **Simplicity:** nothing nobody asked for.

## Output

```
PASS | NEEDS FIXES
Blocking findings: file:line, what fails and how
Evidence: commands and results
Residual risk: ...
```

Findings are reported before anything is fixed. No essay.
