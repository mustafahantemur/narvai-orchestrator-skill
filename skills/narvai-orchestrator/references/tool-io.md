# Tool I/O — output compression and external docs

## RTK — explicit mode on this machine

RTK is installed (`rtk`, verified with `rtk gain`). The transparent PreToolUse hook is **deliberately not installed**: Orca already owns every hook point in `~/.claude/settings.json`, and patching that chain risks a working Orca integration. See `setup-dev-harness.ps1 -RtkHook On` if that tradeoff is ever re-taken.

So: prefix noisy supported commands explicitly.

```
rtk dotnet build ...
rtk dotnet test ...
rtk npm run build
rtk git diff
```

Use it for test suites, builds, linters, git commands with large output, package/tool output. Do not pipe tiny commands through it — no benefit.

**Safety rule:** if filtered output is not enough to diagnose a failure, rerun that *specific* command raw, or inspect the raw log narrowly. Compression must never hide required evidence.

RTK is an I/O optimization, not a methodology.

## Output discipline regardless of RTK

- targeted test filters, never the whole suite by reflex
- cap or tail build logs
- `git diff --stat` before a full diff; split giant diffs by file
- grep for the specific error rather than pasting the log
- never paste thousands of passing test lines

Compression reduces input volume. It does not authorize broader exploration.

## External documentation — Context7

Context7 MCP is connected. Use it **conditionally**, never as always-loaded context.

Reach for it when:

- framework or library behavior may have changed
- implementing an unfamiliar or current API
- exact configuration options matter
- the repository does not contain enough information to verify usage

Not for ordinary project-local logic.

Query the specific API or topic. Do not dump full library docs into context. Prefer Addy `source-driven-development` for this workflow.

## Source-driven development

1. identify the exact package and the version this project actually has
2. inspect local types/source first if that answers it
3. official docs or Context7 for the exact API if it does not
4. implement only after verifying the API
5. record a short source reference only when the fact is non-obvious or likely to change

External docs never silently override explicit project conventions — surface the conflict.

## Dependencies

Current version, license-clean, **verified not remembered**. AutoMapper/MediatR/MassTransit went commercial Apr 2025 (RPL 1.5, free under $5M revenue). FluentAssertions 8.x is Xceed-licensed; 7.x stays Apache-2.0.

Do not hand-roll platform features: background jobs → Hangfire, HTTP retry/circuit-breaking → Polly. Never stack two retry layers. Check what the project already standardized on before adding anything.
