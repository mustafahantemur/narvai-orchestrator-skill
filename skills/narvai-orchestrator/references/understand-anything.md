# Understanding questions: Understand-Anything graph

Route here when the goal is knowledge about the code: how something works, why it is built that way, what a
change touches, how a business flow runs. No spec, no size gate. The answer is an explanation with
`file:line` references, not code.

Installed 2026-11-10 from commit `182c7fb`:
- plugin root `~/.understand-anything-plugin` (a plain copy, core built);
- all nine `understand*` skills in `~/.claude/skills`;
- the plugin's own hooks are not installed. They look for `.ua/` in the repo and would never fire here.
  Refresh after commits comes from the harness hook `hooks/ua-auto-update.mjs` (below).

## Where the graph lives (never in the repo)

`/understand` writes `.ua/` and `.understandignore` into the analysed directory, and from a worktree it
redirects to the main repo root. So it never runs against the repo or its worktrees. It runs against a
shared clone in the store:

- copy: `<store>/understand/src` (a `git clone --shared` of the repo, detached at `origin/development`)
- graph: `<store>/understand/src/.ua/knowledge-graph.json`, or per module
  `<store>/understand/src/src/Modules/<Modül>/.ua/knowledge-graph.json`

`<store>` comes from the SessionStart line or `<storeRoot>\map.json` (`storeRoot` in `~/.narvai/config.json`).

## Answering (cheap, every time)

1. **Graph exists?** Read `project.gitCommitHash` from the graph. Check drift for the area in question with
   `git -C <repo> diff --name-only <graphCommit> HEAD -- <paths>`. If files in that area changed, say the
   graph may be behind for them.
2. **Query the graph like `understand-chat` / `understand-explain` do**, but against the store path. Do not
   invoke those skills from the repo: they look for `.ua/` in the current directory and stop. Grep the JSON,
   never read it whole:
   - find nodes by `"name"`, `"filePath"` or `"tags"`;
   - follow `edges` from or to the node id (`calls`, `imports`, `depends_on`, `triggers`);
   - use `layers` for where it sits, `tour` for the entry order.
3. **Confirm in source.** The graph is a map, not truth. Check its edges with the `LSP` tool
   (`findReferences`, `incomingCalls`, `goToDefinition`, `goToImplementation`), read the files it points to
   and cite `file:line`. An edge with no matching code is dropped from the answer.
4. **Answer in the user's language:** entry point, steps in order, the files and functions involved, open questions.

No graph: one bounded `graphify` query if `<store>/graphify/graph.json` exists (`references/repo-intelligence.md`),
else grep/LSP. Then offer to build the graph once, as below.

By goal:
- **What a PR or branch affects:** take `git -C <repo> diff --name-only <base>...HEAD`, map the files to graph
  nodes, follow incoming edges for affected callers. Same method as `understand-diff`, without its
  `diff-overlay.json` write.
- **A business flow:** `domain-graph.json` in the store copy if present; building it is `understand-domain`
  run against the store copy, and it dispatches an agent (Heavy Mode).
- **An onboarding guide:** method of `understand-onboard`. Save only when asked, to
  `<docsRoot>\<proje>\...`, never `docs/UA_ONBOARDING.md` in the repo.

## Building the graph (Heavy Mode: name the cost, get a yes)

The full run dispatches one `file-analyzer` agent per batch, up to 5 at a time, plus architecture and tour
agents. Say the file count and that it spends agent tokens before starting.

```bash
REPO=<repo path>; STORE=<store path>; SRC="$STORE/understand/src"
[ -d "$SRC/.git" ] || git clone --quiet --shared --no-checkout "$REPO" "$SRC"
git -C "$REPO" fetch --quiet origin
git -C "$SRC" fetch --quiet "$REPO" "+refs/remotes/origin/development:refs/remotes/origin/development"
git -C "$SRC" checkout --quiet --detach origin/development
```

Then invoke the `understand` skill with the argument `"$SRC" --auto-update`. `--auto-update` opts the graph
in to refresh after commits.

Large repos are built per module, not whole. Measured 2026-11-10: Core has ~7,100 `.cs` files (without
migration designers and snapshots), the frontend ~2,400 `.ts/.tsx`. For a module, pass
`"$SRC/src/Modules/<Modül>"`; its graph lands in `"$SRC/src/Modules/<Modül>/.ua/"`. When answering, look for
the module graph that covers the question before the root one.

Useful excludes:
- Core: `--exclude "**/Migrations/*.Designer.cs,**/*ModelSnapshot.cs"`
- frontend: `--exclude "src/types/api.generated.ts"`

Afterwards `git -C "$REPO" status --short` must show no `.ua/` and no `.understandignore`. If it does, move
them to the store and say so.

## Refresh after commits (user, 2026-11-10)

`ua-auto-update.mjs` runs after every Bash call. When the call was a commit, merge, pull, rebase or
cherry-pick in a repo listed in `map.json`, and a store graph has `autoUpdate: true` and an older commit:
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
