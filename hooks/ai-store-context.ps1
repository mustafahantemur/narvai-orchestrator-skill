#Requires -Version 7.0
<#
    SessionStart hook: if the working directory belongs to a repo that has an external AI store,
    tell the agent where it is. Silent ({}) when there is no match, so it adds nothing outside
    onboarded repos.

    Deliberately does NOT read stdin. A hook that blocks on a pipe that never closes hangs session
    start; the working directory and CLAUDE_PROJECT_DIR are enough to resolve the store.

    Output shape is Claude Code's documented one:
      {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
#>
param([string]$EventName = 'SessionStart', [string]$Source = '')

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Empty { Write-Output '{}'; exit 0 }

$cwd = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
if (-not $cwd) { Write-Empty }

$cfgPath = Join-Path $HOME '.narvai\config.json'
$cfgRoot = if (Test-Path $cfgPath) { (Get-Content $cfgPath -Raw | ConvertFrom-Json).storeRoot } else { $null }
$memoryRoot = if ($env:AI_HARNESS_MEMORY) { $env:AI_HARNESS_MEMORY } elseif ($cfgRoot) { $cfgRoot } else { 'C:\Projects\Features\_harness' }
$mapPath = Join-Path $memoryRoot 'map.json'
if (-not (Test-Path $mapPath)) { Write-Empty }

$map = @{}
try {
    (Get-Content $mapPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $map[$_.Name.TrimEnd('\')] = $_.Value }
} catch { Write-Empty }
if ($map.Count -eq 0) { Write-Empty }

# Walk up from the working directory to find the owning repo.
# Split-Path 'C:' -Parent returns 'C:\', which trims back to 'C:' - compare the trimmed
# forms or the loop never terminates at the drive root. Depth cap is a second belt.
$repo = $null
$probe = $cwd.TrimEnd('\')
for ($depth = 0; $depth -lt 64 -and $probe; $depth++) {
    if ($map.ContainsKey($probe)) { $repo = $probe; break }
    $parent = (Split-Path $probe -Parent)
    if ($parent) { $parent = $parent.TrimEnd('\') }
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
}
if (-not $repo) { Write-Empty }

$store = $map[$repo]
if (-not (Test-Path $store)) { Write-Empty }

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("AI store for this project: $store")
$lines.Add('It lives outside the repository on purpose. Never write harness bookkeeping into the repo.')

$have = @()
foreach ($f in 'project-profile.md', 'invariants.md', 'requirements.md') {
    $p = Join-Path $store $f
    if ((Test-Path $p) -and ((Get-Item $p).Length -gt 200)) { $have += $f }
}
if ($have.Count) { $lines.Add('Filled: ' + ($have -join ', ') + ' - read project-profile.md before exploring the repository.') }

$workRoot = Join-Path $store 'work'
if (Test-Path $workRoot) {
    $current = (git -C $repo branch --show-current 2>$null)
    $onBranch = @()
    $others = 0
    foreach ($d in (Get-ChildItem $workRoot -Directory -ErrorAction SilentlyContinue)) {
        $st = Join-Path $d.FullName 'state.yaml'
        if (-not (Test-Path $st)) { continue }
        $status = (Select-String -Path $st -Pattern '^status:\s*([^#]+)' | Select-Object -First 1).Matches.Groups[1].Value
        $branch = (Select-String -Path $st -Pattern '^branch:\s*([^\s#]+)' | Select-Object -First 1).Matches.Groups[1].Value
        if (-not $status -or $status.Trim() -in @('done', 'archived', 'closed')) { continue }
        if ($current -and $branch -eq $current) { $onBranch += $d } else { $others++ }
    }
    foreach ($d in $onBranch) {
        $lines.Add("Work item on this branch ($current): $(Join-Path $d.FullName 'state.yaml'). On 'devam et' resume from its next_action instead of re-discovering the repository.")
        if ($Source -eq 'compact') {
            $lines.Add("Context was just compacted. Before the next step re-read $(Join-Path $d.FullName 'PROGRESS.md') and its state.yaml; where they differ from the summary, they win.")
        }
    }
    if ($others) { $lines.Add("Other open work items: $others in $workRoot (read one only when the user names it).") }
}

$graph = Join-Path $store 'graphify\graph.json'
if (Test-Path $graph) { $lines.Add("Code graph: $graph (query with graphify --graph ... --budget ...).") }

$text = ($lines -join "`n")
$escaped = $text.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '\n')
Write-Output ('{"hookSpecificOutput":{"hookEventName":"' + $EventName + '","additionalContext":"' + $escaped + '"}}')
exit 0
