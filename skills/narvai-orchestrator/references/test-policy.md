# Test policy

This policy overrides any upstream skill that would force textbook red-green-refactor on every implementation step. Strong tests, yes. Test churn during unstable iteration, no.

## ⛔ Kullanıcının 1. KURALI

Her adımdan sonra test yazılmaz ve koşulmaz. Testler **geliştirme bittiğinde, branch kapanırken**
yazılır. Gereksiz test kalabalığı yok: bir davranış için bir test.

Koşarken **yalnızca kapsam dahilindeki** test projesi/dosyası koşulur. Tüm projenin testini koşmak
gereksiz maliyet — kullanıcı istemedikçe yapılmaz. Geliştirme sırasında doğrulama build ve
type-check ile yapılır.

E2E / Playwright kullanıcı istemedikçe koşulmaz. Neyi atladığını ve nedenini söyle.

## New feature — default sequence

```
approved spec / acceptance criteria
-> implementation exploration and slices
-> build, typecheck, existing targeted tests, smoke during development
-> behavior stabilizes
-> final unit / integration / contract / E2E tests for the accepted behavior
-> relevant verification run
```

Tests protect observable behavior and stable contracts, not incidental implementation detail. Do not build dozens of brittle unit tests around internal structure while the design is still moving.

## When test-first is genuinely worth it

Write the test first when behavior is already stable and the test is cheap:

- bug reproduction and regression
- pure deterministic business logic
- parser / normalizer rules
- a stable API contract
- a security or validation invariant
- previously broken behavior that must never come back

For a bug fix prefer: reproduce → failing regression test (when cheap and reliable) → fix → pass.

## UI and exploratory design

No brittle component tests before the interaction is settled. Verify at runtime during iteration, add durable behavior tests once the interaction stabilizes.

## Spec / test conflict

1. update and approve the spec first
2. mark incompatible tests stale
3. change the code for the revised behavior
4. add or update durable tests once the revised behavior settles

Existing stable regression and contract tests still run where relevant. Never change correct new code just to satisfy a stale test representing an old requirement.

## End-of-feature gate

A non-trivial feature is not complete until the final accepted behavior has appropriate automated tests and the relevant suites pass.

**The coordinator runs the tests before committing and reports real numbers.** "Green" without numbers is not a report. If something was not run, write "I could not measure it" — never guess a result.

## Build gate

Build is mandatory at every slice; tests are not.

Before push or PR, reproduce CI locally — a local Debug build proves nothing about a Release publish:

```
dotnet publish <Api.csproj> -c Release -o <temp> -p:UseAppHost=false -nodeReuse:false
```

In Git Bash use `-p:Xxx=y`, never `/p:Xxx=y` (MSYS rewrites it into a path). If the pipeline builds a Docker image, try `docker build` locally — build only, no `up`, and delete the image and container afterwards.
