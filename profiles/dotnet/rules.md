# .NET rules

- Naming comes from `.editorconfig`: read the `naming_rule` before naming a field or type. IDE-only diagnostics such as IDE1006 do not fail the build, so a green build does not prove the naming; check the LSP diagnostics.
- Errors are typed: a dedicated exception type builds its message from structured properties (enums), never a raw string at the throw site.
- No internal error detail reaches a client: no exception message, stack trace, database text, SQL, file path or internal address in a response. The client gets a stable error code; the detail goes to the log.
- A closed set of values is an enum, compared as an enum, never as a string. Persist it as a string; never mirror an enum in a lookup table.
- A value that needs new code is an enum; one with its own lifecycle or referenced by a foreign key is a table.
- A batch or cascade update is one `SaveChanges` and one event, not one per row.
- Every paged list has a deterministic order ending in a unique key, so pages never repeat or skip rows.
- Migrations come from `dotnet ef migrations add`: the migration, its designer file and the model snapshot change together, and the snapshot is never edited by hand. A migration that can lose data is high risk: say so before generating it.
- Parallel workers never generate migrations; they report the schema need and one owner generates it after the merge, one DbContext at a time.
- Background jobs, retries, mapping, validation and logging use what the project already standardised on. Never stack two retry layers.
- Before adding or upgrading a package, check its current version and its license for that version; several .NET libraries changed license in a major release.
