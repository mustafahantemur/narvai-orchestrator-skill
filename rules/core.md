# Working rules

These rules apply to every task. Project rule files and the project's own conventions outrank them where they are more specific.

## Start

- For any task on code or a repository, run `narvai context` once and work from what it prints: the project's rules, its checks, the open work item, where state is kept.
- The work follows a lifecycle: define, plan, build, verify, review, ship. A small change is build and verify only. Work that touches three or more files, or changes an endpoint, DTO, enum or error code, gets a short written plan first.
- At each of these moments run `narvai next --event <name> [--paths <files>]` and load only the skills it names, by reading the file it prints: `unclear` (the request is ambiguous), `idea`, `plan`, `build`, `library` (an external API), `edit` (before editing a kind of file you have not edited yet in this task), `failure`, `tests`, `refactor`, `migrate`, `perf`, `done`, `review`, `decision`, `prose` (any text a person will read), `ship`.
- Never guess a skill name. `narvai skill --list` shows what exists; `narvai skill <name>` gives the file.

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
- On a red test, first decide which is right, the test or the code: `narvai tests --failed <file>` shows which changed last. Never bend working code to satisfy a stale test, and never weaken a test to make it pass.
- A hook may refuse a command and say what to do instead. Do that. Exceptions are the user's to grant.

## Keep the context small

- Read what the task needs, not the repository. Prefer a search to opening files one by one.
- Do the work yourself unless a part is independent and bulky enough to pay for a fresh agent. Never one agent per file.
- To another agent, report findings, paths and numbers. No preamble, no restating the task.
- Nothing that belongs to the harness is written into a project repository: plans, state, graphs and notes live in the store that `narvai context` names.
