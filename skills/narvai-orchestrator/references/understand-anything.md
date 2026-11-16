# Understanding questions and the Understand-Anything graph

Route here when the goal is knowledge about the code: how something works, why it is built that way, what a
change touches, how a business flow runs. No spec, no size gate. The answer is an explanation with
`file:line` references, not code.

## How to answer (measured, 2026-11-16)

Answer from the source: Grep and the `LSP` tool (`findReferences`, `incomingCalls`, `goToDefinition`,
`goToImplementation`), then read the files and cite `file:line`. On eight questions against a 6,000-file
.NET repo this was as accurate as starting from a graph, faster, and no more expensive
(`<storeRoot>/graph/olcum/sonuc-2026-11-16.md`). Starting from the Understand-Anything graph cost about
twice the turns.

The graph earns its place in two cases:
- **The user wants an area explained or shown.** The layers, the tour and the dashboard give a picture a
  list of files does not.
- **An inventory across a module.** Every `endpoint:` and `table:` node of a module is one grep on the graph
  (`"type": "endpoint"`, `"type": "table"`), with the route, the command it sends and the entity it maps.

The graph is a map, not truth. Its summaries are doc comments or sentences built from code facts; check an
edge in source before you state it.

## Where the graphs live (one shared folder, never in a repo)

Every graph of every repo lives in one folder that all agents read:

- root: `<storeRoot>/graph/` (`storeRoot` in `~/.narvai/config.json`)
- store clone of a repo: `<root>/<repo folder>/` (a `git clone --shared`, detached at the branch in `repos.json`)
- graph of a root: `<root>/<repo>/<root path>/.ua/knowledge-graph.json` (a whole small repo, or one module
  or feature folder of a large one)
- **`<root>/index.json`** lists every graph: path, commit, date, file, node and edge counts, layers,
  `generator` (`script` or absent for model-built). Read it first.
- `<root>/repos.json` lists the repos, their ignore patterns and which folders get their own graph. It is
  project data and lives in the store, not in the harness.

Grep the JSON, never read it whole: nodes by `"name"`, `"filePath"`, `"type"` or `"tags"`; edges by node id
(`imports`, `calls`, `depends_on`, `implements`, `publishes`, `subscribes`, `routes`, `defines_schema`).
`filePath` is relative to the graph's own root folder. Do not invoke `understand-chat` or
`understand-explain` from a repo: they look for `.ua/` in the current directory and stop.

## Building (no model, the default)

```
node <harness>/scripts/graph/ekosistem.mjs                 # every repo in repos.json: clone or fetch, Graphify, Understand-Anything
node <harness>/scripts/graph/ekosistem.mjs --only <repo>   # one repo
node <harness>/scripts/graph/ua-uret.mjs <root> "<name>" "<description>" [--frameworks "A,B"] [--exclude "globs"]   # one root
```

`ua-uret.mjs` writes the same files the `understand` skill writes (`knowledge-graph.json`, `meta.json`,
`fingerprints.json`, `config.json`) with the same node ids, so the dashboard and the `understand*` skills
work on them. Measured: 62 roots of twelve repos, 15,598 files → 47,738 nodes and 126,133 edges in under
three minutes. It adds `endpoint` and `table` nodes the model path does not produce. Summaries come from
the symbol's own doc comment, else from extracted facts ("MediatR handler for X returning Y; depends on Z").

Refresh is a rerun of the same command. Script-built graphs have `autoUpdate: false`.

## Building with a model (Heavy Mode: name the file count, get a yes)

Only for a module where summaries in business language are worth the cost. Measured with Sonnet: about
4,900 fresh input, 43,600 cached-read and 830 output tokens per file.

```
node <harness>/scripts/graph/hazirla.mjs "<root>" "<name>" "<description>" --frameworks "A,B" --exclude "<globs>"
# agents analyse the task files: Workflow tool with scripts/graph/graph-workflow.js, args {stage:"analyze", ...};
# without that tool, dispatch one agent per dispatch-batch-<n>.md with the prompt in graph-workflow.js
node <harness>/scripts/graph/bitir.mjs birlestir "<root>"
# agents: stage "finish" (layers, tour)
node <harness>/scripts/graph/bitir.mjs kaydet "<root>"
```

A later script rebuild keeps the model-written text: before it overwrites a model-built graph,
`ua-uret.mjs` harvests its summaries and tags into `<root>/.ua/summaries.json` and applies them again.

## Things that were learned the hard way

- Run the bundled scripts from the plugin's own copy (`~/.understand-anything-plugin/skills/understand`), as
  the harness scripts do. The hub copy cannot resolve `@understand-anything/core`.
- Python is `py` on this machine; `python` is the Store alias and fails.
- The tool resolves a C# `using X.Y;` as a file path and finds no import edge. The harness scripts build the
  C# import map from type references; a type name declared more than three times in view gets no edge.
- The scan picks up `.ua/` itself on a second run; the scripts always exclude it.
- An agent costs about 50,000 tokens before it reads a file. `hazirla.mjs` fuses small groups into one task
  of at most 35 files or 4,000 lines.
- Useful excludes: `**/Migrations/` (one folder alone was 29,000 lines), generated API types, tests on a
  first pass. Non-code files over 1,500 lines and binary or model files are dropped automatically.
- A module graph has no edges to other modules; cross-module questions go to source or to Graphify.

## Refresh of model-built graphs after commits

`hooks/ua-auto-update.mjs` runs after every Bash call. When the call was a commit, merge, pull, rebase or
cherry-pick in a repo listed in `map.json`, and a graph under `<storeRoot>/graph/<repo folder>` has
`autoUpdate: true` and an older commit, it checks the store clone out at the new HEAD and tells the agent to
run `~/.understand-anything-plugin/hooks/auto-update-prompt.md` for each graph. A full rebuild (more than 30
files or half the project) is not run automatically; say the changed file count and ask.

## Other skills

- **`understand-dashboard`** shows a graph in the browser. It starts a local server, so it runs only when
  the user asks and is stopped when they are done. Pass the graph's folder in the store as the project path.
  Skip its first path, which downloads a viewer tarball; use the local Vite path from the installed plugin.
- **`understand-domain`**, **`understand-knowledge`**, **`understand-figma`** dispatch agents (Heavy Mode)
  and write `.ua/` into their target: point them at a store clone or a folder under `<docsRoot>`, never a repo.
