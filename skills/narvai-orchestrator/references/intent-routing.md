# Intent routing

Route by what the user wants at the end of the turn, not by the words they used. Users type fast, with typos
and sometimes without diacritics: read for meaning. Ask only when two readings lead to
different irreversible actions; otherwise pick the likelier one and say it in a line.

## Read the intent

1. **Outcome.** What should exist when this turn ends?
   - knowledge: explain, analyse, compare;
   - a change: build, fix, refactor, migrate;
   - a decision: plan, spec, pick an option;
   - an artifact: doc, report, summary, sheet, dashboard;
   - a verification: review, test, check a deploy, compare outputs;
   - an operation: commit, PR, merge, CI, Docker, config.
2. **Object.** Which repo, area, PR, branch, deploy, document or screen. Take it from the conversation and the
   repo state (branch, open PR, files just discussed) before asking.
3. **Weight.** Size and risk as in `routing.md`. A question about the code has no size gate.

One message can carry several intents. Order them sensibly: understand before changing, fix before reviewing,
verify before calling it done.

## Intent → skills (preference, not a whitelist)

The session's skill list is the source of truth. A skill whose description fits the intent better than this
table wins. Load a skill when its step comes, not up front.

Most skills are installed for Claude Code only. In Codex or Pi, read the skill file directly instead of
invoking it: `~/.claude/skills/<name>/SKILL.md`, or for plugin skills
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md`. Tools only Claude has
(the Skill, LSP and Agent tools) fall back to reading files, grep and the build.

| Intent | Reach for |
|---|---|
| How the code works, why it is so, what a change affects | `references/understand-anything.md`; the `LSP` tool for definitions, callers and references; `pstack:how` for a walkthrough, `pstack:why` for history and motivation, `graphify` |
| Build or change a feature | sizing and spec flow in this skill; `agent-skills:incremental-implementation`; UI: the design skill named in the project profile + `impeccable` (the project's design system first) + `agent-skills:frontend-ui-engineering`, with the first-pass rule in `house-rules-frontend.md`; not `frontend-design` in a project with a design system (it picks a new aesthetic; fine for a greenfield page); React: `vercel-react-best-practices`, `vercel-composition-patterns`; API shape: `agent-skills:api-and-interface-design`; ASP.NET Core endpoints: `dotnet-webapi`; which .NET specialist: `csharp-expert` |
| Something broken, failing or slow | `mattpocock-skills:diagnosing-bugs` or `agent-skills:debugging-and-error-recovery`; slow: `agent-skills:performance-optimization`; slow .NET code: `analyzing-dotnet-performance`, evidence from a running process: `dotnet-trace-collect`; slow data access: `optimizing-ef-core-queries` + `supabase-postgres-best-practices` |
| Logs, metrics, traces, alerts | `agent-skills:observability-and-instrumentation`, inside the repo's logging and tracing pattern (the project profile names it) |
| Ready to push or open a PR | the definition of done and the contract flow in `references/delivery.md`; commit only when asked |
| CI or PR checks red | `pstack:fix-ci` (CI platform rules from the user's `CLAUDE.md`); a .NET build failure: `binlog-generation` then `binlog-failure-analysis`; a slow .NET build: `build-perf-diagnostics` |
| Merge or rebase conflict | `mattpocock-skills:resolving-merge-conflicts` |
| Review | `code-review` or `agent-skills:code-review-and-quality` in a zero-context agent; security of a diff (auth, permissions, money, data): `differential-review`; misuse-prone APIs and config: `sharp-edges`; general security: `security-review`; UI and accessibility: `web-design-guidelines`; UX, look and responsive of a screen: `impeccable` `critique`, `audit`, then `polish`; a static scan: `semgrep` or `codeql`, read results with `sarif-parsing`; over-engineering: `ponytail:ponytail-review`; comments: `pstack:no-comments` |
| Simplify without changing behaviour | `simplify`, `agent-skills:code-simplification`; C#: `csharp-refactoring` |
| Plan, spec, or an idea still vague | `agent-skills:spec-driven-development`, `agent-skills:planning-and-task-breakdown`; vague: `agent-skills:interview-me`, `agent-skills:idea-refine`; stress-test: `mattpocock-skills:grilling` |
| Library or API facts | context7 MCP, `agent-skills:source-driven-development`; deeper: `mattpocock-skills:research` |
| Migration or deprecation | `agent-skills:deprecation-and-migration` |
| Tests | `references/test-policy.md`; `agent-skills:test-driven-development`; would tests catch a bug: `test-gap-analysis`; files without tests: `find-untested-sources`; weak tests: `test-anti-patterns`, `assertion-quality`; mutation campaigns: `mutation-testing` (needs the `mewt` tool) |
| Database schema, migration or SQL | `supabase-postgres-best-practices` (skip its Supabase-only parts: RLS, pg_cron, pgmq) with `optimizing-ef-core-queries`; migrations still follow the house rules |
| Dependencies and package versions | risk of a dependency tree or an upgrade: `supply-chain-risk-auditor`; aligning NuGet versions in a repo without central package management (HR, IAM): `convert-to-cpm` |
| See a screen in a real browser | `playwright-cli`, only when the user asks (Playwright rule in `CLAUDE.md`); browsers download on first use |
| Prose for people (summary, report, doc, PR body) | `pstack:unslop`, `pstack:technical-writing`; decisions: `agent-skills:documentation-and-adrs`; to share: the Artifact tool |
| Recap of what was done | `pstack:what-did-i-get-done`, `pstack:recall` |
| Say it plainly | `pstack:bro` |
| Chart or data view | `dataviz`; a map of the code: `understand-dashboard` |
| Office files | `anthropic-skills:docx`, `xlsx`, `pdf`, `pptx` |
| Commit, PR, release hygiene | `agent-skills:git-workflow-and-versioning`, `pstack:make-pr-easy-to-review` (commit only when asked) |
| "From now on, whenever X" | `update-config` for a hook; a preference goes to memory |

## Third-party skills: pinned copies

The register is `third-party.json` in the harness folder: each source repo and commit, the skills taken from it,
the local changes, manual steps and the plugins narvai routes to. The reviewed copies live in `third-party/` and
`node narvai.mjs install` puts them in the skill library; nothing is fetched at install time. Updating a source
follows the steps in that file. Left out on purpose: Trail of Bits `insecure-defaults` (a plugin Workflow with many
agents) and Vercel deploy skills.

## Skill hygiene

`node <harness>/narvai.mjs usage [--days 30]` counts Skill tool calls and slash
commands in `~/.claude/projects` and lists installed skills never used. It deletes nothing. Baseline
2026-11-11: 160 installed, 8 ever invoked; most of the rest are listing noise or were installed that day.
Around 2026-12-11, run it with `--days 30` and propose removing what stayed unused; the user decides.
Hook-driven skills (ponytail) never show up in the count.

## Tell the user which skills

Each time a skill is invoked, or a reference stands in for one, say so in one short line in the user's language,
with the reason, for example: "`pstack:how`: to walk the flow step by step." When a work item closes, its
summary lists the skills used. Skills that run through hooks (ponytail, the store context, the graph
auto-update) are named only when they changed something.

## Gates still apply

The table never overrides `CLAUDE.md`. These still hold:
- Heavy Mode needs a yes.
- Subagents need a yes.
- Review and test are asked first.
- Commit only when asked.
- Never start the app.
- The user's own rules (their `CLAUDE.md` / `AGENTS.md`), e.g. which platforms are read-only.
