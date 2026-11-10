# Repository intelligence — Graphify + LSP

Graphify is the first structural map for a large or unfamiliar repository. It is a navigation aid, never truth.

## Indexing policy — code only by default

Run Graphify's local deterministic code-structure pass: classes/types, functions/methods, imports, call relationships, file relationships, SQL structure where applicable.

**Do not enable the document / PDF / image / transcript semantic pass by default.** It costs tokens and agent time. Propose it only when non-code knowledge genuinely matters and the value clearly exceeds the cost — and get a yes first.

Output and cache are derived runtime intelligence, not canonical memory, and they **never stay in the repository**.

`graphify update <path>` has no output flag — it always writes `<path>/graphify-out/`. So never run it directly against a repo. Use the wrapper, which builds and then moves the index into the external store, restores a previous index for an incremental run, and checks `git status` afterwards:

```
setup-dev-harness.ps1 -Graph <repo path>
```

The index lands at `<store>/graphify/graph.json`. Every read points at it explicitly:

```
graphify query "<question>" --budget 500 --graph <store>/graphify/graph.json
graphify affected "<symbol>" --depth 2   --graph <store>/graphify/graph.json
graphify god-nodes --top 5               --graph <store>/graphify/graph.json
graphify path "A" "B"                    --graph <store>/graphify/graph.json
graphify explain "X"                     --graph <store>/graphify/graph.json
```

`--budget` is the context guard: the query prints how many nodes it cut rather than dumping the graph.

Measured on this machine: a 55-file .NET module produced 250 nodes / 406 edges in 5s with no LLM call. The LLM-touching steps are `label` and the clustering pass — the wrapper passes `--no-cluster`, so extraction stays deterministic.

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
