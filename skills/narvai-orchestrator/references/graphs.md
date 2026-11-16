# Code graphs (optional)

Graphs are not a default step. Measured on 2026-11-16 on a 6,000-file .NET repository: eight questions were answered as accurately with search and the language server alone, in less time and for the same tokens; starting from the Understand-Anything graph cost about twice the turns. Independent measurements agree for small and medium repositories. A graph earns a query in three cases:

- **Reach across modules or repositories.** "Who references this type", "what does this change touch": `graphify affected` and `graphify explain` return connections with file and line.
- **An inventory of one module.** Every endpoint and table of a module is one search on its Understand-Anything graph (`"type": "endpoint"`, `"type": "table"`).
- **Showing an area to the user.** Layers, a tour, the dashboard.

A graph is a map, not truth. Confirm in source before you state anything.

## Where they are

`narvai graph status` lists every graph with its commit against the repository's HEAD. They live in `<storeRoot>/graph/`, never in a repository:

- `<repo>/graphify-out/graph.json` and `ekosistem/graph.json` (all repositories merged)
- `<repo>/<root>/.ua/knowledge-graph.json`, one per module or feature folder
- `index.json` (every graph) and `repos.json` (which repositories and folders; project data)

```
graphify explain "<Symbol>"             --graph <path>
graphify affected "<Symbol>" --depth 2  --graph <path>
graphify query "<terms>" --budget 500   --graph <path>
```

Search an Understand-Anything graph, never read it whole: nodes by `name`, `filePath`, `type`, `tags`; edges by node id.

## Building

`narvai graph build [--only <repo>] [--head]` builds both without a model. `narvai hooks` installs git hooks that rebuild a repository's graphs in the background after a commit, merge or checkout.

A model-written graph of one module (summaries in business language) is a heavy step that needs the user's yes: `scripts/graph/hazirla.mjs`, agents on the task files it writes, then `scripts/graph/bitir.mjs`. A later script build keeps the model-written text.
