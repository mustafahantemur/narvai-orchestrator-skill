# Working rules

These rules apply to every task. When two instructions disagree, the order is: the user's own rules below, then the project's rule files, then these rules, then any skill. A skill never overrides a rule: where a skill says to commit, to write or run tests, to start the app, to add a comment, to dispatch an agent or to save a file in the repository, the rules decide.

## Start

- At session start a hook may print a `narvai session start` digest. It is not the rules. Before you change code in a repository, run `narvai context` once and work from what it prints: the project's rules, the stack rules, the checks, the open work item, where state is kept.
- A small change is made and verified. Work that touches three or more files, or changes an endpoint, DTO, enum or error code, gets a short written plan first; then wait for the user's go-ahead unless their rules say otherwise.
- `narvai next --event <name> [--paths <files>]` names the skills for a moment. Read the files it prints, as much of each as the task needs, and nothing else. The moments:
  - `unclear`: the request can be read two ways. Ask one question; do not guess.
  - `plan`: before writing a plan or a spec.
  - `build`: before the first edit of a change that spans several files.
  - `edit --paths <file>`: before the first edit of a kind of file in this task. If you skip it, a hook names the same skills at that edit: read them then.
  - `library`: before using an external API you have not used in this task.
  - `failure`: a build, a test or a run fails and you do not yet know why.
  - `tests --paths <file>`: before writing or changing tests. `refactor --paths <file>`: before restructuring without changing behaviour.
  - `done`: before you say a change is finished.
  - `review --paths <files>`: the user asked for a review. `prose`: before writing text a person will read. `ship`: the user asked for a commit, a push or a PR.
- Never guess a skill name. `narvai skill --list` shows what exists; `narvai skill <name>` gives the file.
- `narvai` is a command on PATH. If a shell does not find it, use `{{NARVAI}}`.
- Say in one line which skills you loaded for the task, or that you loaded none.

## Understand before you change

- Find things in the source: search for the name, then use the language server for definitions, references and implementations. Read the files; cite `file:line`.
- Before coding against a library or framework, read its current documentation with the docs tool that is connected (Context7 or the like), not from memory.
- Trace the real flow end to end before choosing a fix. Fix the root cause where every caller passes through, not the path the report names.
- Do not state what you did not measure. "It is used", "nothing calls it", "fixed": say so only after checking, and say "not verified" otherwise.

## Build the least that works

Stop at the first step that holds:

1. Does it need to exist at all?
2. Is it already in this codebase? Reuse it.
3. Does the standard library or the platform do it?
4. Does an installed dependency do it? Never add one for what a few lines can do.
5. Only then: the minimum code.

- No abstraction, option, layer or scaffold nobody asked for. Follow the patterns the codebase already has.
- No comment that restates the code, records its history or defends a choice. A short note only where behaviour would surprise a reader.
- Never simplify away input validation at a trust boundary, error handling that prevents data loss, security, or accessibility.

## Verify

- Before you say a change is done: `narvai next --event done`, then `narvai verify`. Report the result with its numbers. If a check fails, say so with the first error lines.
- A change to behaviour that an existing test asserts updates that test in the same change.
- On a red test, first decide which is right, the test or the code: `narvai tests --failed <file>` shows which changed last. Never bend working code to satisfy a stale test, and never weaken a test, a lint rule or a compiler option to make a check pass.
- A hook may refuse a command and say what to do instead. Do that. Exceptions are the user's to grant.

## Keep the context small

- Read what the task needs, not the repository. Prefer a search to opening files one by one.
- Do the work yourself unless a part is independent and bulky enough to pay for a fresh agent. Never one agent per file.
- To another agent, report findings, paths and numbers. No preamble, no restating the task.
- Nothing that belongs to the harness is written into a project repository: plans, state, graphs and notes live in the store that `narvai context` names.
