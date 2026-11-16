# Understanding questions: Understand-Anything graph

Route here when the goal is knowledge about the code: how something works, why it is built that way, what a
change touches, how a business flow runs. No spec, no size gate. The answer is an explanation with
`file:line` references, not code.

Installed 2026-11-10 from commit `182c7fb`:
- plugin root `~/.understand-anything-plugin` (a plain copy, core built);
- all nine `understand*` skills in the hub (`third-party/skills`);
- the plugin's own hooks are not installed. They look for `.ua/` in the repo and would never fire here.
  Refresh after commits comes from the harness hook `hooks/ua-auto-update.mjs` (below).

## Where the graphs live (one shared folder, never in a repo)

`/understand` writes `.ua/` into the analysed directory, and from a worktree it redirects to the main repo
root. So it never runs against a repo or its worktrees. Every graph of every repo lives in one folder that
all agents (Claude Code, Codex, Antigravity) read:

- root: `<storeRoot>\understand\` (`storeRoot` in `~/.narvai/config.json`; today
  `C:\Projects\AI\Features\_harness\understand\`)
- copy of a repo: `<root>\<repo folder name>\` (a `git clone --shared`, detached at `origin/development`)
- graph of a whole small repo: `<root>\<repo>\.ua\knowledge-graph.json`
- graph of one module of a large repo: `<root>\<repo>\src\Modules\<Modül>\.ua\knowledge-graph.json`
- **`<root>\index.json`** lists every graph: path, commit, date, file/node/edge counts, layers. Read it first.

## Answering (cheap, every time)

1. **Find the graph** in `index.json`. Check drift for the area in question with
   `git -C <repo> diff --name-only <graph commit> HEAD -- <paths>`. If files in that area changed, say the
   graph may be behind for them.
2. **Query the graph like `understand-chat` / `understand-explain` do**, but against the store path. Do not
   invoke those skills from the repo: they look for `.ua/` in the current directory and stop. Grep the JSON,
   never read it whole:
   - find nodes by `"name"`, `"filePath"` or `"tags"`;
   - follow `edges` from or to the node id (`imports`, `calls`, `depends_on`, `implements`, `publishes`);
   - use `layers` for where it sits, `tour` for the entry order.
3. **Confirm in source.** The graph is a map, not truth. Summaries are written by a model. Check edges with
   the `LSP` tool (`findReferences`, `incomingCalls`, `goToDefinition`, `goToImplementation`), read the files it
   points to and cite `file:line`. An edge with no matching code is dropped from the answer.
4. **Answer in the user's language:** entry point, steps in order, the files and functions involved, open questions.

No graph for the area: one bounded `graphify` query if `<store>/graphify/graph.json` exists
(`references/repo-intelligence.md`), else grep/LSP. Then offer to build the graph, as below.

By goal:
- **What a PR or branch affects:** take `git -C <repo> diff --name-only <base>...HEAD`, map the files to graph
  nodes, follow incoming edges for affected callers. Same method as `understand-diff`, without its
  `diff-overlay.json` write.
- **A business flow:** `domain-graph.json` next to the graph if present; building it is `understand-domain`
  run against the store copy, and it dispatches an agent (Heavy Mode).
- **An onboarding guide:** method of `understand-onboard`. Save only when asked, to
  `<docsRoot>\<proje>\...`, never `docs/UA_ONBOARDING.md` in the repo.

## Building a graph (Heavy Mode: name the file count, get a yes)

The build is scripted in `C:\Projects\AI\Harness\scripts\understand\`. The scripts do every step that needs
no model; agents only analyse file groups, layers and the tour.

```bash
ROOT=<storeRoot>/understand; REPO=<repo path>; SRC="$ROOT/$(basename "$REPO")"; T=C:/Projects/AI/Harness/scripts/understand
[ -d "$SRC/.git" ] || git clone --quiet --shared --no-checkout "$REPO" "$SRC"
git -C "$REPO" fetch --quiet origin
git -C "$SRC" fetch --quiet "$REPO" "+refs/remotes/origin/development:refs/remotes/origin/development"
git -C "$SRC" checkout --quiet --detach origin/development

# 1. scan, import map, groups, one task file per group (no model)
node $T/hazirla.mjs "<project root>" "<name>" "<one-sentence description>" --frameworks "A,B" --exclude "<globs>"
# 2. agents analyse the groups: Workflow tool, scriptPath $T/graph-workflow.js,
#    args {stage:"analyze", agentDir:"<plugin>/agents", projects:[{label, ua:"<project root>/.ua", batches:[...]}]}
# 3. merge, write the layer and tour task files (no model)
node $T/bitir.mjs birlestir "<project root>"
# 4. agents: same workflow, args {stage:"finish", agentDir, projects:[{label, ua}]}
# 5. validate, save graph + fingerprints + meta, update index.json (no model)
node $T/bitir.mjs kaydet "<project root>"
```

`hazirla.mjs` prints the group numbers to pass as `batches`. Without the Workflow tool, dispatch one agent
per group yourself with the prompt in `graph-workflow.js`.

Rules that were learned the hard way (2026-11-16):
- **Run the bundled scripts from the plugin's copy** (`~/.understand-anything-plugin/skills/understand`), as
  the harness scripts do. The hub copy of the same scripts cannot find `@understand-anything/core`.
- **Python is `py`** on this machine; `python` is the Store alias and fails.
- **C# imports:** the tool resolves `using X.Y;` as a file path and finds no edge at all (measured: 0 edges in
  348 files). `hazirla.mjs` builds the C# import map itself from type references visible through the file's
  namespaces. It is approximate: a type name declared more than three times in view gets no edge.
- **The scan picks up `.ua/` itself** on a second run; `hazirla.mjs` always excludes it.
- **Large repos are built per module.** Core has ~7,000 `.cs` files, the frontend ~2,500 `.ts/.tsx`. A module
  graph has no edges to other modules.
- Useful excludes. Core: `**/Migrations/**` (entities and EF configurations already describe the schema;
  one Catalog migration folder alone was 29,000 lines). Frontend: `src/types/api.generated.ts`. Tests are
  left out of a first pass unless asked. `hazirla.mjs` drops non-code files over 1,500 lines by itself
  (seed data, dictionary dumps) and lists them as `skippedData`.
- **An agent costs ~50,000 tokens before it reads a file** (measured). `hazirla.mjs` therefore fuses small
  groups into one task of at most 35 files or 4,000 lines; outputs keep their original group numbers.
  Measured on 395 C# files with Sonnet, before fusing: per file ~4,900 fresh input, ~43,600 cached read and
  ~830 output tokens; 8 minutes with 5 agents.
- Summaries are generated in English; Turkish domain terms stay as written in the code.
- The LLM assemble-review pass of the skill is skipped; `bitir.mjs kaydet` validates and repairs the graph
  deterministically.

Afterwards `git -C "$REPO" status --short` must show no `.ua/` and no `.understandignore`. If it does, move
them to the store and say so.

## Refresh after commits (user, 2026-11-10)

`ua-auto-update.mjs` runs after every Bash call. When the call was a commit, merge, pull, rebase or
cherry-pick in a repo listed in `map.json`, and a graph under `<storeRoot>\understand\<repo folder>` has
`autoUpdate: true` and an older commit:
1. it checks the store copy out at the new HEAD;
2. it tells the agent to run `~/.understand-anything-plugin/hooks/auto-update-prompt.md` for each graph,
   with `PROJECT_ROOT` set to the graph's folder.

The prompt first classifies the change without any agent:
- cosmetic, deleted or generated files only: the graph moves forward, no agent;
- structure changed in the same folders: `file-analyzer` for those files only;
- new or removed folders, or more than 10 files: architecture and tour agents as well;
- more than 30 files or half the project: a full rebuild. This one is **not** run automatically; tell the
  user the changed file count and ask.

Report in one line what ran. To turn it off for a graph, set `autoUpdate: false` in its `.ua/config.json`.

## Other skills

- **`understand-dashboard`** shows the graph in the browser. It starts a local server, so it runs only when
  the user asks and is stopped when they are done. Pass the graph's folder in the store as the project path.
  Skip its first path, which downloads and runs a viewer tarball from GitHub; use the local Vite path from
  the installed plugin, which was reviewed and built from the lockfile. Name the running server and its URL.
- **`understand-knowledge`** builds a graph of a markdown wiki or docs folder. Point it at a folder under
  `<docsRoot>\...` or a store copy, never a repo. It writes `.ua/` into the target and dispatches
  agents (Heavy Mode).
- **`understand-figma`** builds a design graph of a Figma file. It calls `api.figma.com` with a token from the
  environment and dispatches agents (Heavy Mode). Run it in a folder under `<docsRoot>\...`.
