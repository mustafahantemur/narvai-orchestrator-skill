# Repository intelligence — Graphify + LSP

Graphify is a structural map of a repository, built without a model. It is a navigation aid, never truth, and it is not the first step: on 2026-11-16 eight questions on a 6,000-file .NET repo were answered as accurately with Grep and LSP alone, in less time and for the same tokens (`<storeRoot>/graph/olcum/sonuc-2026-11-16.md`). Reach for it when the question is reach or impact across modules or repos.

## Indexing policy — code only by default

Run Graphify's local deterministic code-structure pass: classes/types, functions/methods, imports, call relationships, file relationships, SQL structure where applicable.

**Do not enable the document / PDF / image / transcript semantic pass by default.** It costs tokens and agent time. Propose it only when non-code knowledge genuinely matters and the value clearly exceeds the cost — and get a yes first.

Output and cache are derived runtime intelligence, not canonical memory, and they **never stay in the repository**.

`graphify update <path>` has no output flag — it always writes `<path>/graphify-out/`. So it never runs against a repo. It runs against the store clone of the repo, in the shared graph folder that every agent reads:

- root: `<storeRoot>/graph/` (`storeRoot` in `~/.narvai/config.json`)
- one repo: `<root>/<repo folder>/graphify-out/graph.json`
- all repos merged: `<root>/ekosistem/graph.json` (cross-repo questions; large and slow to load)
- `<root>/index.json` lists every graph with its commit and build time. `<root>/repos.json` lists the repos, their ignore patterns and roots; that list is project data and lives in the store, not in the harness.

Build or refresh with no model call:

```
node <harness>/scripts/graph/ekosistem.mjs                 # every repo in repos.json: clone or fetch, Graphify, Understand-Anything, merged graph
node <harness>/scripts/graph/ekosistem.mjs --only <repo>   # one repo
```

Every read points at a graph explicitly:

```
graphify explain "X"                     --graph <root>/<repo>/graphify-out/graph.json
graphify affected "<symbol>" --depth 2   --graph <root>/<repo>/graphify-out/graph.json
graphify query "<question>" --budget 500 --graph <root>/<repo>/graphify-out/graph.json
graphify path "A" "B"                    --graph <root>/<repo>/graphify-out/graph.json
graphify god-nodes --top 5               --graph <root>/<repo>/graphify-out/graph.json
```

`--budget` is the context guard: the query prints how many nodes it cut rather than dumping the graph. `explain` and `affected` return connections with file and line and are the most precise.

Measured on this machine (2026-11-16): OmniMind Core, 6,205 files → 48,965 nodes / 114,624 edges in about 6 minutes with no LLM call; twelve repos in about 15 minutes; one query takes 2 to 8 seconds on the Core graph. The driver passes `--no-cluster`, so extraction stays deterministic; `label` and community naming are the LLM-touching steps. The older `setup-dev-harness.ps1 -Graph` wrapper writes to the per-repo store and is superseded by the driver.

## Use by size

- **TRIVIAL** — skip if the file/symbol is already known
- **SMALL** — LSP and direct source first; Graphify only if impact or ownership is unclear
- **STANDARD / LARGE / HIGH-RISK** — project rules and current spec first → one narrow Graphify structural query (neighborhood, path, relationship) → confirm exact definitions and references with LSP/compiler → read only the selected source and test files

Never read a whole `GRAPH_REPORT.md` into context as a normal step. Prefer bounded queries: `graphify query`, `graphify path A B`, `graphify explain <symbol>`.

## Trust model

- deterministic extracted code edges — strong navigation evidence
- inferred / semantic edges — never authoritative
- conclusions about public API, callers or behavior must still be verified in source, LSP, compiler or tests

If a graph answer conflicts with current source, the source wins and the graph is stale.

## Freshness

Use Graphify's own caching and incremental behavior. Do not rebuild or re-query the whole graph after every edit.

Refresh on: project onboarding · entering a substantially different subsystem · before a STANDARD+ impact review when relevant code changed enough to stale the graph · when a query clearly conflicts with source.

Record freshness in state rather than pretending stale derived data is truth.

## LSP and compiler come after the map, before the source dump

Available here: `csharp-lsp` and `typescript-lsp` plugins in Claude Code, `typescript-language-server` globally, Roslyn through `dotnet`.

Use: go to definition · find references · implementations · type hierarchy · workspace symbols. For .NET prefer Roslyn/compiler/project information. For TypeScript and Next.js prefer the TS language service.

Verify with the language server, not memory.

## Never

Do not search from a filesystem root. No `find /`, no `find C:/`, no repo-wide recursive scan outside the project — on Windows these run for hours and outlive the agent that started them. Always search a named directory. This binds delegated workers too: say it in the brief, and verify the process actually died.
