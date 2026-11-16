# narvai

[Türkçe](README.md) · English

One development setup for Claude Code, Codex, Antigravity, Orca and, optionally, Hermes. Skills, rules and memory live
in one place and every agent reads the same files. A decision saved in Claude Code comes back from AgentMemory in Codex
or Antigravity. For .NET and React/Next.js work, `narvai-orchestrator` reads the intent of a request, picks the skills,
keeps the project store outside the repository and enforces the "done" gate (`verify` plus a pre-push hook).

## How it works

```
Orca (workspace, worktrees)
  ├─ Claude Code    Claude subscription, its own CLI
  ├─ Codex          ChatGPT subscription, its own CLI
  └─ Hermes         optional; main model Codex (ChatGPT subscription)
Antigravity, Pi     the same skills and rules
AgentMemory         shared local memory for all of them (MCP; the memory provider in Hermes)
```

Each subscription is used through its own official client. When a task moves from Claude Code to Codex, the context
comes from AgentMemory and from `PROGRESS.md` in the store.

- Every skill has one physical copy, in this repository. The entries in `~/.claude/skills`, `~/.agents/skills` (Codex),
  `~/.gemini/config/skills` (Antigravity) and Pi are junctions to it. Hermes reads it directly through
  `skills.external_dirs`.
- `rules/GLOBAL.md` is the source of the rules. `sync` renders every agent's rules file from it and replaces
  `{{AI_ROOT}}` with the install root.
- Memory lives in AgentMemory (`http://localhost:3111`, no API key, embeddings computed on the machine). Hermes uses it as
  its native memory provider and the other agents use it over MCP. Every repository shares one memory scope
  (`memoryProject` in `~/.narvai/config.json`, default `shared`).

## Folder layout

The default root is `C:\Projects\AI`. Change it with `-Root` at install time.

| Folder | Contents |
|---|---|
| `Harness` | this repository: skills, rules, hooks, scripts |
| `Features` | plans, specs, ADRs, reports, artifacts and the `_harness` store |
| `Memory` | AgentMemory data |
| `Worktrees` | worktrees opened by Orca |
| `Apps` | agent app folders (moved by `scripts/move-app-homes.ps1`) |

## Install

Requirements: Windows 11, PowerShell 7, node 22+, git and winget.

```powershell
git clone https://github.com/mustafahantemur/narvai-orchestrator-skill.git C:\Projects\AI\Harness
cd C:\Projects\AI\Harness
.\install-dev-harness.ps1                       # root C:\Projects\AI
.\install-dev-harness.ps1 -Root D:\AI           # another root
.\install-dev-harness.ps1 -ClaudeSubscription   # Claude subscription in Hermes (see Known limits)
.\install-dev-harness.ps1 -DryRun               # print the plan only
```

The bootstrap installs what is missing, then runs `node narvai.mjs setup`.

| Component | Source |
|---|---|
| Claude Code | npm `@anthropic-ai/claude-code` |
| Codex CLI | npm `@openai/codex` (the CLI of the Codex desktop app when that is installed) |
| Hermes | official installer `hermes-agent.nousresearch.com/install.ps1` |
| Orca | winget `StablyAI.Orca` |
| Antigravity | winget `Google.Antigravity` |
| AgentMemory | npm `@agentmemory/agentmemory@0.9.33` |
| Pi, uv, RTK, OpenSpec, Spec Kit, Graphify | npm, winget and uv |

On a machine that already has the tools, wire them up with:

```powershell
node narvai.mjs setup [--root D:\AI] [--claude-subscription] [--dry-run]
```

`setup` tries every step on its own. It prints `OK` for what it did, `SKIP` for what it skipped and `TODO` for work you
do by hand. Running it again is safe, and it backs up every file it changes under `~/.narvai/backups`.

### What setup does

- `install --adopt` writes the config, the skill junctions, the rules files and the Claude hooks. A rules file written by
  hand is backed up and taken over.
- For AgentMemory it writes `.env` (on-device embeddings, the 8 core MCP tools, the data folder, the shared identity
  `shared-dev`), registers a logon task that starts the server and adds the server to Claude Code, Codex and Antigravity
  over MCP. When the server is down, the MCP bridge fails instead of writing to a separate store
  (`AGENTMEMORY_FORCE_PROXY=1`).
- In Hermes it stops borrowing the Claude and Codex logins, sets the skill folders and a view of the Claude plugin skills,
  makes AgentMemory the memory provider and adds the Context7 MCP server. With `adoOrg` in the config it adds the Azure
  DevOps MCP server with its write tools excluded. It makes Codex the main model (`openai-codex`, `hermesModel` in the
  config, default `gpt-5.6-sol`); `--claude-subscription` installs the Claude DirectSDK plugin and makes it the main model
  instead.
- In Codex it turns on the `CLAUDE.md` fallback for project instructions and turns off the import sync that copies
  Claude content.
- When Orca is closed it replaces Hermes' `--yolo` argument with `--checkpoints`, sets the worktree folder to
  `<root>\Worktrees` and makes Claude Code the default agent (`orcaDefaultAgent` in the config: `claude`, `codex` or
  `hermes`).

### By hand

```powershell
claude                                        # sign in to Claude Code
codex login                                   # sign in to the Codex CLI
.\scripts\move-app-homes.ps1 -Apply           # with every agent app closed

# only if you use Hermes
hermes auth add openai-codex --type oauth     # Hermes' main model is Codex; sign in with the ChatGPT subscription
```

Open Antigravity once and sign in with your Google account.

## Daily use

| Task | How |
|---|---|
| Open an agent from Orca | new tab in Orca, agent Claude Code or Codex |
| Resume a session | `claude --resume <id>`, `codex resume`; in Hermes `hermes -c` |
| Switch agent | continue the task in a new tab with the other agent; the context comes from AgentMemory and `PROGRESS.md` |
| Search memory | ask the agent, or `memory_recall`, `memory_smart_search` |
| Save a decision | `DECISION <ID> \| topic: ... \| decision: ... \| status: current \| date: YYYY-MM-DD \| source: ...` |
| Memory health | `agentmemory status`, viewer at `http://localhost:3113` |
| Add a skill | put its folder under `third-party/skills`, list it in `third-party.json`, `node narvai.mjs install` |
| Change a rule | edit `rules/GLOBAL.md`, then `node narvai.mjs sync` |
| After a Claude plugin update | `node narvai.mjs setup` |
| Status | `node narvai.mjs doctor`, `agentmemory status`; for Hermes `hermes status` |

A decision saved again with the same type and ID supersedes the old one. Recall returns only the current record.

## Commands

| Command | What it does |
|---|---|
| `setup [--root <dir>] [--claude-subscription] [--dry-run]` | `install --adopt`, then the Hermes, AgentMemory, MCP, Codex and Orca wiring |
| `install [--root <dir>] [--adopt]` | config, sync, vendored third-party skills (junctions), Claude hook registration |
| `sync [--adopt]` | links the narvai skill into the Claude, Codex, Antigravity and Pi skill folders; renders the Claude, Codex, Antigravity, Pi and Hermes rules files from `rules/GLOBAL.md`; writes the Qwen pointer |
| `doctor` | lists what is installed, missing or stale |
| `usage [--days N]` | which skills are actually used |
| `estimate <paths>` | token estimate of what a worker would read; does it fit or should it be split |
| `verify [--all] [--hook]` | the repository's definition of done (`verify.json` in the store or the stack defaults) |
| `hooks <repo>` | a pre-push hook that runs `verify --hook`; an existing hook is kept and runs first |
| `eval [--only=..] [--dry-run]` | runs `evals/scenarios.json` through headless Claude Code; subscription login only, refuses when an API key is set |

## Folders in this repository

- `skills/narvai-orchestrator/`: the router skill and its references.
- `third-party/` and `third-party.json`: reviewed skill copies pinned to a commit (caveman, modern-web-guidance,
  impeccable, the dotnet skills and others), with their source repository and local changes.
- `rules/`: `GLOBAL.md` holds the shared rules, `hermes-identity.md` the Hermes identity and the Claude tool name mapping.
- `hooks/`: `narvai-guard.mjs` (narvai reminder, subagent context limit), `store-context.mjs` (store and work item),
  `ua-auto-update.mjs` (code graph after a commit).
- `setup.mjs`: the wiring applied by `narvai setup`.
- `install-dev-harness.ps1`: new machine bootstrap. `scripts/move-app-homes.ps1`: moves the app folders under the root.
- `evals/`: behaviour scenarios. `templates/CLAUDE.md`: a template for the user rules.

## Known limits

- The Hermes catalog lists the AgentMemory plugin for Linux and macOS only. On Windows, mirroring the built-in
  `MEMORY.md` writes needs POSIX file locking and does not run. Saving, recall, search and conversation capture work.
- The Claude subscription in Hermes is off by default; the main model is Codex. The DirectSDK plugin runs the unmodified `claude` CLI with your
  own login, but Anthropic restricts using the subscription from third-party tools and that use can be billed as extra
  usage. Check Anthropic's terms, and on a Team or Enterprise plan your company policy, before you turn it on.
  `node narvai.mjs setup --claude-subscription` enables the plugin and makes it the main model.
- Setup never writes Orca's settings while Orca is running. It reports a `TODO` instead.
- caveman shortens chat replies only. Code, commits, documents and memory records are written in normal prose.

## License

Every skill under `third-party/` keeps the license of its source (the LICENSE file in its folder and
`third-party.json`). The rest is private.
