# narvai

A thin layer that makes coding agents work in your repositories the way a careful engineer would: the project's rules in front of them, the right skill at the moment it is needed, the checks run before "done", and nothing of the harness written into the repository.

Works with Claude Code and Codex. Stack profiles exist for .NET and Next.js; another stack is one folder.

## What is in it

| Part | Where | What it does |
|---|---|---|
| Rules | `rules/core.md` + your `~/.narvai/rules.md` | One short generated rule file per agent (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`). |
| CLI | `narvai.mjs`, `cli/` | The mechanical part: context, routing, checks, stale tests, graphs, doctor. |
| Hook | `hooks/guard.mjs`, `hooks/deny.json` | One hook for both agents: refuses listed commands and says what to do instead, names the skills when a kind of file is edited for the first time, prints the repo context at session start. |
| Routes | `registry/routes.json` | The lifecycle (define, plan, build, verify, review, ship) and which skills belong to which moment. |
| Skills | `skills/`, `third-party/skills/` | Pinned, reviewed copies; source, commit and license in `third-party.json`. A small listed set is linked into the agents' skill folders. The rest is read by path when a route names it. |
| Stack profiles | `profiles/<stack>/` | Detection, checks, language server, contract steps, and the rules a compiler cannot check. |
| Agent profiles | `agents/` | Explore, implement and review subagents, written out for both agents. |
| Store | outside every repository | Per-repository state, project rules, check overrides, graphs. |

## Install

Node 22 (or 20.17+) and git.

```
node narvai.mjs install --root <dir>    # config, rule files, skill links, agents, hooks
node narvai.mjs doctor                  # what is installed, what is stale, what is too big
```

`--root` is where the store lives (`<dir>/Features/_harness`). A rule file narvai did not generate is left alone unless you pass `--adopt`; a backup is kept in `~/.narvai/backups`. In Codex, open `/hooks` once and trust the narvai entries.

Per repository: add its path and a store folder to `<storeRoot>/map.json`, then `node narvai.mjs hooks <repo>` for the git hooks (checks before push, a stale-test note at commit, graph refresh after commit).

## Yours, not the repository's

| File | Purpose |
|---|---|
| `~/.narvai/rules.md` | Your own rules, appended to the core rules. |
| `~/.narvai/guard.json` | Your deny rules, same shape as `hooks/deny.json`. |
| `<store>/<project>/project-rules.md` | Project rules. A first line `include: <path>` pulls in a shared file. |
| `<store>/<project>/verify.json` | Replaces the profile's checks for that repository. |

## Commands

```
narvai context                      rules, stacks, checks, store and open work for this repo
narvai next --event <name> [--paths ...]   the skills that belong to this moment
narvai verify [--changed] [--tests] build, typecheck, lint; test checks only with --tests
narvai tests [--failed <file>]      changed sources whose tests were not touched; which side changed last
narvai contract                     the steps when an endpoint, DTO or enum changed
narvai skill <name> | --list        where a skill is and what it is for
narvai graph <build|status>         optional code graphs, built without a model
narvai allow <rule-id>              a timed exception to a deny rule, when the user agrees
narvai doctor [--fix]               installation and content checks
narvai sync                         regenerate rule files, links, agents and hooks
```

`node narvai.mjs` without a command lists all of them.

## How a skill gets used

Nothing is loaded up front. The agent runs `narvai next --event <moment>` and reads only the files it prints. A route in `registry/routes.json` names an event, optional path globs and at most three skills. `registry/skills.json` records every skill on disk with a reviewed fit (`core`, `stack`, `on-demand`, `out`). To add or change a route, edit `routes.json` and run `narvai sync`; `narvai doctor` fails on a route that names a skill that does not exist.

## Adding a stack

Create `profiles/<name>/profile.json` (`detect`, `source`, `tests`, `checks`, `lsp`, `skills`, `contract`, `ignore`; copy an existing one) and `profiles/<name>/rules.md` with at most 25 lines of rules a linter or compiler cannot check. Add routes for its skills.

## Code graphs

Optional. `narvai graph build` builds a Graphify graph per repository and Understand-Anything graphs per module from the repositories listed in `<storeRoot>/graph/repos.json`, without a model. Measured on a 6,000-file repository, they did not make answers more accurate or cheaper than search plus the language server; they help with cross-repository reach and with showing an area to a person. See `skills/narvai-orchestrator/references/graphs.md`.

## Updating a vendored skill set

Clone the source at the new commit, read what changed, copy only the listed skills over `third-party/skills`, re-apply the local changes recorded in `third-party.json`, update the commit there, run `node --test tests/*.test.mjs` and `narvai doctor`.
