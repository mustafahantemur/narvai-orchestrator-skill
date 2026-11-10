# Delivery: done means verified

`narvai verify` (from the harness: `node <harness>/narvai.mjs verify`) runs the definition of done for the
repo it is called in and prints one line per check: PASS, FAIL or SKIPPED with the reason. Report those
lines; a check that did not run is reported as not run. The pre-push hook installed by
`narvai.mjs hooks <repo>` runs `verify --hook`: the same checks minus those marked `"hook": false` (the slow
test runs, which `narvai verify` runs before calling the work done). The gate holds whichever agent or person
pushes; an existing hook (git-lfs, lefthook) is kept as `pre-push.local` and runs first.

What it runs comes from the project profile's `## Definition of done` block in the store; without one it
uses the stack defaults below. When the profile says the project has no remote CI, this local run is the
only gate.

## Stack defaults

**.NET** (a `*.slnx` or `*.sln` at the repo root):
- `dotnet build <solution> -c Release -nodeReuse:false`, 0 errors, no new warnings.
- `dotnet test` on the test projects in scope (`test-policy.md`): the projects the profile lists, plus the
  test projects of the modules touched.
- Migrations come from `dotnet ef migrations add`, so the migration, its Designer and the model snapshot
  change together; the snapshot is never edited by hand. A data-loss migration is HIGH-RISK.
- `.editorconfig` rules only the IDE reports (IDE1006 naming) are checked through LSP diagnostics.
- Logging and tracing follow the repo's pattern, which the profile names. No internal error detail reaches
  a client (`house-rules-code.md` 10a).

**Node / React** (a `package.json`): the `typecheck`, `lint` and `test` scripts that exist, through the
package manager the lockfile names. Tests in scope only. A screen change also follows the project's
visual-reference rule, and the narrow-phone check in `house-rules-frontend.md` rule 12.

## Backend ↔ frontend contract

When an endpoint, DTO, enum or error code changes:

1. **Backend first:** the endpoint with OpenAPI metadata (`dotnet-webapi`) and its tests.
2. **Regenerate the client types** from a backend that has the change, which the user runs (never start
   it). Generated files are never edited by hand. The profile names the commands.
3. **Drift check against a real schema URL.** A drift check that skips without a URL proves nothing;
   `narvai verify` reports it as SKIPPED.
4. **Frontend** uses the new contract; validation schemas follow the generated types.
5. **Two PRs, one merge window:** each description names the other. The backend merges first or together;
   a breaking change keeps the old shape on the backend until the frontend that drops it is merged.
