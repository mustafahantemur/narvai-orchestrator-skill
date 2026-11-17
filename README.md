# narvai

narvai sits between a coding agent (Claude Code or Codex) and your repositories. It gives the agent the project's rules before it changes code, names the skill to read at each step of the work, runs the project's checks before the agent says "done", and refuses a short list of commands you never want run. It writes nothing into your repositories.

Stack profiles exist for .NET and Next.js. Another stack is one folder.

`KULLANIM.md` is the usage guide, in Turkish: one section per job (adding a repository, changing a rule, lifting a deny rule, building graphs, checking the shared memory, troubleshooting) with the command for each.

## How a session goes

1. A hook prints a three-line digest at session start: the repository, its stacks and checks, any open work item.
2. Before changing code the agent runs `narvai context`. It prints the project's rules, the stack rules, the checks and whether the shared memory answers.
3. At each step the agent runs `narvai next --event <step>` and reads the skill files it prints. For example, before editing a React component:

   ```
   $ narvai next --event edit --paths src/features/orders/order-list.tsx
   shop-ui  <repo>/.claude/skills/shop-ui/SKILL.md  UI work
   impeccable  .../third-party/skills/impeccable/SKILL.md
   vercel-react-best-practices  .../SKILL.md  React component or data fetching change
   ```

4. Before it reports, the agent runs `narvai verify`: build, typecheck and lint. Test checks run only with `--tests`.

If the agent skips step 3 for an edit, the hook names the same skills when the first matching file is edited.

## Parts

| Part | Where | What it does |
|---|---|---|
| Rules | `rules/core.md` and your `~/.narvai/rules.md` | `narvai sync` joins them into one rule file per agent (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`), under 100 lines. |
| CLI | `narvai.mjs`, `cli/` | Context, routing, checks, stale-test detection, graphs, doctor, eval. |
| Hook | `hooks/guard.mjs`, `hooks/deny.json` | One hook for both agents. It refuses denied commands, names skills at the first edit of a kind of file, prints the session digest. |
| Routes | `registry/routes.json` | Which skills belong to which step. |
| Skills | `skills/`, `third-party/skills/` | Pinned copies with source, commit and license in `third-party.json`. sync links 15 of them into the agents' skill folders. The agent reads the others by path when a route names them. |
| Stack profiles | `profiles/<stack>/` | Detection globs, checks, language server, contract steps, and rules a compiler cannot check. |
| Agent profiles | `agents/` | Explore, implement and review subagents for both agents. |
| Store | a folder outside every repository | Per-repository rules, check overrides, work state and graphs. |

## Install

You need Node 22 (or 20.17 and later) and git.

```
node narvai.mjs install --root <dir>
narvai doctor
```

`install` writes `~/.narvai/config.json`, generates the rule files, links the skills, writes the agent profiles, registers the hook, and puts a `narvai` command into `~/.local/bin`. If that folder is not on PATH, the command goes to `~/.narvai/bin` and sync tells you to add it. `--root` is the folder that holds the store (`<dir>/Features/_harness`).

sync leaves a rule file alone if narvai did not generate it. Pass `--adopt` to take it over; narvai keeps a backup in `~/.narvai/backups`. In Codex, open `/hooks` once and trust the narvai entries. Until you do, Codex skips the hook.

For each repository, add its path and a store folder to `<storeRoot>/map.json`. `narvai hooks <repo>` adds two git hooks: the checks before a push, and a note at commit that lists changed sources whose tests were not touched.

### A new machine

The whole setup comes from this repository and the commands in it. Three things are yours and live outside it. Copy them from the old machine or start empty.

| What | Where | When it is missing |
|---|---|---|
| Your rules and deny rules | `~/.narvai/rules.md`, `~/.narvai/guard.rules.mjs` | Only `rules/core.md` and the shipped deny rules apply. |
| The store | `<root>/Features/_harness` | `map.json` starts empty. There are no project rules, check overrides or graphs yet. |
| Shared memory data | `<root>/Memory/agentmemory` | The memory starts empty. |

1. Install Node 22, git and the agents you use, Claude Code and Codex.
2. Install the shared memory with `npm install -g @agentmemory/agentmemory@0.9.33`. Code graphs need `uv tool install graphifyy` and a copy of the Understand-Anything plugin in `~/.understand-anything-plugin`. `install` prints the clone command for the plugin when it is missing, and `narvai doctor` reports a tool that is not on PATH.
3. Clone this repository and run `node narvai.mjs setup --root <root>`. setup runs `install`, then configures what it finds: AgentMemory with its settings, its restart task on Windows, its MCP entry in each agent and its graph index, then Hermes, Codex and Orca. It ends with a list of what is left to do by hand.
4. Run `narvai guard apply` if you brought deny rules, then `narvai doctor`.
5. In Codex, open `/hooks` and trust the narvai entries.

`setup` and `install` are safe to run again. Paths come from `~/.narvai/config.json`, and the code names no machine, user or project. One file does: `evals/scenarios.json` asks about files of the two repositories it was written against. Put your own scenarios in `<storeRoot>/dev-harness/evals/scenarios.json` and `narvai eval` uses those.

## Commands

```
narvai context                               rules, stacks, checks, memory and open work for this repository
narvai next --event <step> [--paths <files>] the skills for this step
narvai verify [--changed] [--tests]          build, typecheck and lint; test checks only with --tests
narvai tests [--failed <file>]               changed sources whose tests were not touched; which side of a red test changed last
narvai contract                              the steps when an endpoint, DTO or enum changes
narvai skill <name> | --list                 where a skill is and which routes use it
narvai graph <status|build|refresh>          code graphs kept in the store
narvai graph memory [--reset] [--migrate]    the knowledge graph of the shared memory, built from its records
narvai doctor [--fix]                        what is installed, what is broken, what is too large
narvai sync                                  regenerate rule files, links, agent profiles and the hook
narvai eval [--only=a,b] [--rejudge=<dir>]   behaviour scenarios through headless Claude Code
narvai allow <rule-id>                       a timed exception to a deny rule; only you can run it
narvai guard [apply [<file>]]                list the deny rules, or put your own in force from their source
```

`narvai` with no arguments lists every command. `KULLANIM.md` shows which one to use for a given job.

## Files that are yours

| File | Purpose |
|---|---|
| `~/.narvai/rules.md` | Your own rules. They come first when two rules disagree. |
| `~/.narvai/guard.rules.mjs` | The source of your deny rules: a module that exports `rules` (a `.json` file with `{ "rules": [...] }` works too). |
| `~/.narvai/guard.json` | Your rules in force. `narvai guard apply` writes it from the source; the guard refuses a direct edit. |
| `~/.narvai/config.json` | Store location, eval worktrees, the shared memory endpoint and its restart command. |
| `<store>/<project>/project-rules.md` | Project rules. A first line `include: <path>` pulls in a file shared by several repositories. |
| `<store>/<project>/verify.json` | Replaces the profile's checks for that repository. |
| `<store>/graph/memory/<memoryProject>.json` | Optional. A decision table, entity names and relations for the memory graph. |

Order of precedence: your rules, the project's rule files, `rules/core.md`, then any skill. A skill never overrides a rule. If a skill says to commit or to write tests first, the rules decide.

## The guard

`hooks/guard.mjs` refuses the commands the deny rules describe and tells the agent what to do instead. The shipped rules cover recursive searches from a filesystem root. Your own rules live in `~/.narvai/guard.rules.mjs`; `narvai guard apply` validates them, keeps a backup, puts them in force and logs what changed in `~/.narvai/guard.log`. `narvai guard` lists every rule and the last change.

The guard catches honest mistakes. It is not a sandbox, and a command written to avoid a pattern will pass.

- A rule without `tool` applies to shell commands. A rule with `tool` applies to every tool whose name matches. `path` matches an edited file.
- You lift a rule for a limited time with `narvai allow <rule-id>`. The command needs a terminal on its input, which an agent's shell does not have.
- A rule marked `fixed` cannot be lifted. Both `narvai allow` and direct writes to the guard's own files are fixed rules.
- An agent can change your rules only through `narvai guard apply`, when you ask it to. The log and `narvai doctor` show who changed what, so a rule cannot disappear unseen.
- A rule file that does not parse counts as empty, and a rule whose expression does not compile is skipped alone. `narvai doctor` reports both.

## Routes and skills

A route in `registry/routes.json` has an event, optional path globs and at most three skills. `except` removes test, story or generated files from a route's globs. A route with no skills prints one line of advice, such as "a generated file: regenerate it".

`registry/skills.json` lists every skill on disk with a reviewed fit: `core`, `stack`, `on-demand` or `out`. To change a route, edit `routes.json` and run `narvai sync`. `narvai doctor` fails when a route names a skill that does not exist.

The lifecycle follows `addyosmani/agent-skills`: define, plan, build, verify, review, ship. Stack, UI, security and review skills from other sets are attached to one of those steps.

## Adding a stack

Create `profiles/<name>/profile.json` with `detect`, `source`, `tests`, `checks`, `lsp`, `skills`, `contract` and `ignore`. Copy an existing profile as a start. Put at most 25 lines of rules that a linter or compiler cannot check into `profiles/<name>/rules.md`. Add routes for the stack's skills.

## Shared memory

If `config.json` has a `memory` entry, `narvai context` checks that the endpoint answers before the agent works:

```json
"memory": { "url": "http://127.0.0.1:3111/agentmemory/livez", "start": "schtasks /run /tn \"AgentMemory (unified-harness)\"" }
```

When the endpoint does not answer, narvai runs the `start` command and waits up to 25 seconds. The output says `memory: reachable`, or tells the agent to stop and inform you. `narvai doctor` fails on an unreachable memory. On Windows, `narvai setup` registers AgentMemory as a task that runs at logon and every 15 minutes, and restarts the server only when it is down.

### The memory graph

AgentMemory fills its knowledge graph from session observations. A record saved with `memory_save` never reaches it, so the graph stays empty when agents only save records. narvai builds the graph from the records and imports it. No model is called.

- Every current record becomes a node, linked to its concept tags and to the files its `source` names.
- A project file adds more. `<storeRoot>/graph/memory/<memoryProject>.json` can name a markdown decision table, entities with the spellings to look for, and relations between entities. Each decision row and each entity becomes a node, linked to the records and decisions that mention it. `KULLANIM.md` has an example.

`narvai graph memory` brings the graph in line with the records. The hook starts the same sync in the background at session start and ten seconds after a record is saved. A sync that finds nothing new stops. Additions are imported on top. When a node or a relation has gone, the graph is reset and imported whole. `narvai graph status` shows whether the graph is current. AgentMemory's viewer shows it, on port 3113 by default.

AgentMemory asks before it indexes an existing graph store. `narvai graph memory --migrate` gives that go-ahead once, and `narvai setup` runs it.

## Code graphs

narvai keeps two graphs per repository in `<storeRoot>/graph/`, never in the repository: a Graphify graph and Understand-Anything graphs per module. A script builds both without calling a model. `<storeRoot>/graph/repos.json` lists the repositories.

A graph is current when it matches the repository's working tree, uncommitted and untracked files included. `narvai graph status` shows each one. At session start the hook starts `narvai graph refresh` in the background. It rebuilds a stale graph of the repository you are in, at most once every 30 minutes (`graphMinutes` in the config). `narvai graph build --only <repo> --worktree` rebuilds at once.

Graphs are optional for the agent. Measured on a 6,000-file repository with nine questions, an agent that used a graph answered no more accurately than one that used search alone, and it took more turns. Use the graphs to look at an area yourself. `skills/narvai-orchestrator/references/graphs.md` says when a query is worth it.

## Checking the installation

| Check | Command |
|---|---|
| Unit and end-to-end tests of the CLI and the hook | `node --test tests/*.test.mjs` |
| Installation, rule sizes, routes, guard rules, memory, graphs | `narvai doctor` |
| Agent behaviour on 17 scenarios, each in a new headless Claude Code session | `narvai eval` |

`narvai eval` needs two linked git worktrees, named in `evalRepos` in the config, because scenarios edit files and the runner resets the tree between them. `narvai eval --rejudge=<dir>` scores a saved run again after you change a check.

## Updating a vendored skill set

Clone the source at the new commit and read what changed. Copy only the listed skills over `third-party/skills`. Apply the local changes recorded in `third-party.json` again and update the commit there. Then run the tests and `narvai doctor`.
