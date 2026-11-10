# Project context — deterministic discovery

Never start with "read the whole repository".

## Precedence

1. Repository instruction files: `CLAUDE.md`, `.claude/CLAUDE.md`, nested `CLAUDE.md`, `AGENTS.md`, nested `AGENTS.md`
2. `.editorconfig`, `CONTRIBUTING.md`, architecture docs
3. `project-profile.md` from the external store (derived navigation card, not a replacement for the above)
4. `invariants.md` from the external store
5. Generic skills and engineering principles — last

Explicit project instructions are authoritative within their documented scope. If generic best practice disagrees with the repository, surface the tradeoff; never silently rewrite architecture.

## Discovery order

1. loaded project instructions
2. the store's `project-profile.md` if current (`setup-dev-harness.ps1 -Where <repo>`)
3. canonical spec / work state if the item already exists
4. solution / project / package manifests
5. bounded Graphify structural lookup when the subsystem is large or ownership is unclear → `repo-intelligence.md`
6. LSP: definition, references, implementations, type hierarchy, workspace symbols
7. compiler / project graph (Roslyn for .NET, TS language service for TypeScript/Next.js)
8. targeted `rg` / `git grep` / `git log`
9. exact files, exact ranges
10. relevant tests
11. external docs only when local source cannot answer a library fact → `tool-io.md`

Do not ask a model to infer a dependency graph that tools can cheaply prove.

## project-profile.md

Create or refresh only when useful. Target **≤ 1,200 tokens**. It is a navigation card, not an architecture encyclopedia.

Contents, nothing more:

- stack and major modules
- authoritative instruction files and their precedence
- build / test / lint / typecheck commands
- architectural boundaries that materially affect implementation
- database / migration rules if relevant
- one or two representative code-pattern locations
- where tests live
- protected / high-risk areas
- deterministic navigation tools available
- a source reference for every derived rule

Refresh only when the underlying instruction or configuration sources changed.

## Greenfield

For an empty or new repository:

1. clarify the product goal
2. canonical spec before architecture
3. simplest stack that satisfies current requirements
4. minimal project instructions and commands
5. no speculative extension points or layers
6. a store `SPEC.md` per work item (`spec-policy.md`); OpenSpec or Spec Kit only if the user wants the repo to adopt one
7. tests and CI only to the degree the project actually needs

Do not turn a small new project into an enterprise framework.

## Brownfield

- existing conventions are the default
- no opportunistic refactors
- characterize unclear legacy behavior before changing it
- find one nearby working example before inventing a pattern
- migrations need explicit compatibility and rollback thinking
- do not spread a small feature across new layers because a framework suggests them
