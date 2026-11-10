# Anti-overengineering

Ponytail is the primary simplicity lens. Use this compact policy during implementation; load the full Ponytail skill only for review.

## The ladder — before adding any machinery

```
Is this required by the currently accepted spec?
-> Does the repository already have the pattern or helper?
-> Does the language / runtime / standard library already solve it?
-> Does an existing project dependency already solve it?
-> Can the current repository pattern be extended directly?
-> Only then: the smallest new code or abstraction that works.
```

## Defaults

- YAGNI
- one implementation does not justify an interface or factory
- one caller does not justify a framework
- no configuration nobody currently needs
- do not hand-roll platform or stdlib behavior without a reason
- no extension points for hypothetical future features
- prefer deleting and shrinking over adding layers when behavior stays correct

## Hunt list

unnecessary interface or base class · one-use abstraction · speculative extension point · service/factory/registry/event bus not required by current behavior · duplicate DTO/mapper/wrapper layers · a new dependency without clear payoff · a generalized framework for one feature · configuration nobody asked for · unrelated cleanup bundled in · a wrapper around an existing repository abstraction · an extra cache/background job/event flow without measured need · premature performance optimization · duplicate spec or docs · test helpers more complicated than the behavior under test

## Before new architecture

1. What pattern does this repository already use for the same concern?
2. Can that pattern be extended directly?
3. Is the new abstraction required by more than one real current use case?
4. Does this add a boundary, or merely hide a function call?
5. Is the data/domain shape explicit and appropriate?
6. Is state owned in one clear place?
7. Are errors represented consistently with the project?
8. Is backwards compatibility required?
9. Does concurrency or ordering matter?
10. Does this introduce hidden coupling?

Project rules first, then at most **1-3 pstack principles that materially constrain this design** — never the whole set. Project-specific rules outrank generic principles when they intentionally differ. Do not redesign the repository to match a generic skill.

## Which simplifier, when

- **Ponytail** — the simplicity/YAGNI lens. `pstack:ponytail-review` on STANDARD+ diffs, on SMALL changes that introduced an abstraction or dependency, and on any diff suspected of over-engineering. Complexity only — it does not replace correctness, security, performance or test gates.
- **Addy `code-simplification`** — only when a behavior-preserving structural cleanup still remains after the above.
- **pstack `unslop`** — persisted prose only, never code.

Do not run overlapping simplifiers just because they are installed. Repo-wide `ponytail-audit` is explicit, on-demand maintenance — never automatic.

The final version should have **fewer moving parts than the first draft**.
