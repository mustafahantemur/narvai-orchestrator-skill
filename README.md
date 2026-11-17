# narvai

narvai sits between a coding agent (Claude Code or Codex) and your repositories. It gives the agent the project's rules before it changes code, names the skill to read at each step of the work, runs the project's checks before the agent says "done", and refuses a short list of commands you never want run. It writes nothing into your repositories.

Stack profiles exist for .NET and Next.js. Another stack is one folder.

## How a session goes

1. A hook prints a three-line digest at session start: the repository, its stacks and checks, any open work item.
2. Before changing code the agent runs `narvai context`. It prints the project's rules, the stack rules, the checks and whether the shared memory answers.
3. At each step the agent runs `narvai next --event <step>` and reads the skill files it prints. For example, before editing a React component:

   ```
   $ narvai next --event edit --paths src/features/orders/order-list.tsx
   omnimind-ui  <repo>/.claude/skills/omnimind-ui/SKILL.md  UI work
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

## Commands

```
narvai context                               rules, stacks, checks, memory and open work for this repository
narvai next --event <step> [--paths <files>] the skills for this step
narvai verify [--changed] [--tests]          build, typecheck and lint; test checks only with --tests
narvai tests [--failed <file>]               changed sources whose tests were not touched; which side of a red test changed last
narvai contract                              the steps when an endpoint, DTO or enum changes
narvai skill <name> | --list                 where a skill is and which routes use it
narvai graph <status|build|refresh>          code graphs kept in the store
narvai doctor [--fix]                        what is installed, what is broken, what is too large
narvai sync                                  regenerate rule files, links, agent profiles and the hook
narvai eval [--only=a,b] [--rejudge=<dir>]   behaviour scenarios through headless Claude Code
narvai allow <rule-id>                       a timed exception to a deny rule; only you can run it
```

`narvai` with no arguments lists every command.

## Files that are yours

| File | Purpose |
|---|---|
| `~/.narvai/rules.md` | Your own rules. They come first when two rules disagree. |
| `~/.narvai/guard.json` | Your deny rules, in the format of `hooks/deny.json`. The guard refuses an agent that touches this file. |
| `~/.narvai/config.json` | Store location, eval worktrees, the shared memory endpoint and its restart command. |
| `<store>/<project>/project-rules.md` | Project rules. A first line `include: <path>` pulls in a file shared by several repositories. |
| `<store>/<project>/verify.json` | Replaces the profile's checks for that repository. |

Order of precedence: your rules, the project's rule files, `rules/core.md`, then any skill. A skill never overrides a rule. If a skill says to commit or to write tests first, the rules decide.

## The guard

`hooks/guard.mjs` refuses the commands the deny rules describe and tells the agent what to do instead. The shipped rules cover recursive searches from a filesystem root. Your own rules go in `~/.narvai/guard.json`.

The guard catches honest mistakes. It is not a sandbox, and a command written to avoid a pattern will pass.

- A rule without `tool` applies to shell commands. A rule with `tool` applies to every tool whose name matches. `path` matches an edited file.
- You lift a rule for a limited time with `narvai allow <rule-id>`. The command needs a terminal on its input, which an agent's shell does not have.
- A rule marked `fixed` cannot be lifted. Both `narvai allow` and writes to the guard's own files are fixed rules.
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
