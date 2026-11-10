#Requires -Version 7.0
<#
    agent-context-budget.ps1 - INPUT PAYLOAD estimator.

    This measures how large a payload you are about to feed a model. It is NOT model
    context telemetry. Claude Code, Codex and Pi do not expose live context usage to a
    script, so this tool never reports "current context". Quote its output as an estimate.

    Estimator: bytes / 3.6 for prose and code. Turkish text with diacritics tokenizes
    worse than English, so treat the number as a floor with roughly +/-25% error.

    Usage:
      .\agent-context-budget.ps1 -Path src\Modules\Fabric -Pattern *.cs
      .\agent-context-budget.ps1 -Diff
      .\agent-context-budget.ps1 -Diff -Against origin/development
      .\agent-context-budget.ps1 -Path .ai -Mode SMALL
#>
[CmdletBinding()]
param(
    [string[]]$Path,
    [string]$Pattern = '*',
    [switch]$Diff,
    [string]$Against,
    [ValidateSet('TRIVIAL', 'SMALL', 'STANDARD', 'LARGE', 'HIGH-RISK')]
    [string]$Mode = 'STANDARD'
)

$ErrorActionPreference = 'Stop'
$CharsPerToken = 3.6

$Targets = @{
    'TRIVIAL'   = 8000
    'SMALL'     = 20000
    'STANDARD'  = 40000
    'LARGE'     = 50000
    'HIGH-RISK' = 60000
}

function Est([long]$bytes) { [int][math]::Round($bytes / $CharsPerToken) }

$rows = [System.Collections.Generic.List[object]]::new()
$total = 0L

if ($Diff) {
    $gitArgs = if ($Against) { @('diff', '--numstat', $Against) } else { @('diff', '--numstat') }
    $stat = git @gitArgs 2>$null
    if (-not $stat) { Write-Host 'No diff.' -ForegroundColor DarkGray }
    foreach ($line in $stat) {
        $p = $line -split "`t"
        if ($p.Count -lt 3) { continue }
        $changed = [int]($p[0] -replace '-', '0') + [int]($p[1] -replace '-', '0')
        $bytes = $changed * 45L   # rough: 45 bytes per changed line
        $total += $bytes
        $rows.Add([pscustomobject]@{ Item = $p[2]; Bytes = $bytes; Tokens = Est $bytes })
    }
}

foreach ($p in $Path) {
    if (-not (Test-Path $p)) { Write-Warning "not found: $p"; continue }
    $item = Get-Item $p
    $files = if ($item.PSIsContainer) { Get-ChildItem $p -Recurse -File -Filter $Pattern } else { @($item) }
    foreach ($f in $files) {
        $total += $f.Length
        $rows.Add([pscustomobject]@{ Item = $f.FullName; Bytes = $f.Length; Tokens = Est $f.Length })
    }
}

if ($rows.Count -eq 0) { Write-Host 'Nothing to estimate. Pass -Path and/or -Diff.' -ForegroundColor Yellow; return }

$rows | Sort-Object Tokens -Descending | Select-Object -First 25 |
    Format-Table @{L = 'est. tokens'; E = { $_.Tokens }; A = 'right' }, @{L = 'bytes'; E = { $_.Bytes }; A = 'right' }, Item -AutoSize |
    Out-String -Width 160 | Write-Host

$est = Est $total
$target = $Targets[$Mode]

Write-Host ''
Write-Host ("  files/entries : {0}" -f $rows.Count)
Write-Host ("  ESTIMATED payload tokens : ~{0:N0}   (bytes/{1}, not live context)" -f $est, $CharsPerToken)
Write-Host ("  {0} working target : {1:N0}" -f $Mode, $target)

if ($est -le $target) {
    Write-Host '  within target' -ForegroundColor Green
} elseif ($est -le $target * 1.5) {
    Write-Host '  over target - narrow the slice or read ranges instead of whole files' -ForegroundColor Yellow
} else {
    Write-Host '  well over target - split into slices or hand off; do not just read it all' -ForegroundColor Red
}

Write-Host ''
Write-Host '  Emergency bands (model context, NOT measured here):' -ForegroundColor DarkGray
Write-Host '    60-80k stop exploring | 80-100k prepare handoff | 100-120k persist state' -ForegroundColor DarkGray
Write-Host '    120-140k no new branch | >=140k hard stop, fresh session' -ForegroundColor DarkGray
Write-Host ''
