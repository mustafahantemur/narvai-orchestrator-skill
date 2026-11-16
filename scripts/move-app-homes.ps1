#Requires -Version 7.0
<#
  Moves the agent apps' home folders under C:\Projects\AI\Apps and leaves a junction at each old path,
  so every app, IDE extension, hook and virtualenv keeps resolving its usual location.

  Close every agent app first (Claude Code sessions and Desktop, Codex, Hermes Desktop, Orca, Antigravity).
  The script refuses to run while any of them is alive. Moves are renames on the same volume: a locked folder
  fails and is reported; nothing is ever copied, so junctions inside a folder are never followed.

    .\move-app-homes.ps1            # dry run: prints the plan and the blockers
    .\move-app-homes.ps1 -Apply     # move + junction, then point Orca's new worktrees at C:\Projects\AI\Worktrees
    .\move-app-homes.ps1 -Rollback  # undo every move recorded in the manifest
#>
[CmdletBinding()]
param([switch]$Apply, [switch]$Rollback, [string]$Root, [string[]]$Only)
$ErrorActionPreference = 'Stop'

$cfgFile = Join-Path $env:USERPROFILE '.narvai\config.json'
if (-not $Root) { $Root = if (Test-Path $cfgFile) { (Get-Content $cfgFile -Raw | ConvertFrom-Json).aiRoot } }
if (-not $Root) { $Root = 'C:\Projects\AI' }
$Root = $Root -replace '/', '\'
$AppsRoot = Join-Path $Root 'Apps'
$Manifest = Join-Path $AppsRoot 'move-manifest.json'
$U = $env:USERPROFILE
$Plan = [ordered]@{
  "$U\.claude"                     = "$AppsRoot\claude"
  "$U\.codex"                      = "$AppsRoot\codex"
  "$U\.agents"                     = "$AppsRoot\agents"
  "$U\.gemini"                     = "$AppsRoot\gemini"
  "$U\.pi"                         = "$AppsRoot\pi"
  "$U\.narvai"                     = "$AppsRoot\narvai"
  "$U\.agentmemory"                = "$AppsRoot\agentmemory"
  "$U\.orca"                       = "$AppsRoot\orca-home"
  "$env:APPDATA\orca"              = "$AppsRoot\orca-appdata"
  "$env:LOCALAPPDATA\hermes"       = "$AppsRoot\hermes"
  "$U\orca\workspaces"             = (Join-Path $Root 'Worktrees\orca-legacy')
}
# Which running apps hold each folder; -Only moves a subset while unrelated apps stay open.
$Holders = @{
  claude = 'claude', 'Code'; codex = 'codex', 'ChatGPT', 'Orca'; agents = 'codex', 'ChatGPT', 'Orca'; gemini = 'Antigravity', 'agy'
  agentmemory = 'iii'; 'orca-home' = 'Orca', 'orca'; 'orca-appdata' = 'Orca', 'orca'; 'orca-legacy' = 'Orca', 'orca'
  hermes = 'Hermes'; pi = 'pi'; narvai = @()
}
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if ($Only) { foreach ($k in @($Plan.Keys)) { if ($Only -notcontains (Split-Path $Plan[$k] -Leaf)) { $Plan.Remove($k) } } }
$Blockers = @($Plan.Values | ForEach-Object { $Holders[(Split-Path $_ -Leaf)] }) | Sort-Object -Unique
if (($Apply -or $Rollback) -and $Blockers -contains 'iii') { agentmemory stop 2>&1 | Out-Null; Start-Sleep -Seconds 2 }

function Busy {
  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $Blockers -contains $_.ProcessName }
  if ($Plan.Values -contains "$AppsRoot\hermes") {
    $p = @($p) + @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$env:LOCALAPPDATA\hermes\*" })
  }
  $p | Where-Object { $_ } | Group-Object ProcessName | ForEach-Object { "$($_.Name) x$($_.Count)" }
}

if ($Rollback) {
  if (-not (Test-Path $Manifest)) { throw "no manifest at $Manifest" }
  $busy = Busy; if ($busy) { throw "close these first: $($busy -join ', ')" }
  $done = Get-Content $Manifest -Raw | ConvertFrom-Json
  foreach ($m in @($done) | Sort-Object { $_.at } -Descending) {
    if ((Get-Item $m.from -Force -ErrorAction SilentlyContinue).LinkType -eq 'Junction') { cmd /c rmdir "$($m.from)" }
    [System.IO.Directory]::Move($m.to, $m.from)
    Write-Host "restored $($m.from)"
  }
  Remove-Item $Manifest
  return
}

$busy = Busy
Write-Host ($busy ? "BLOCKED by running apps: $($busy -join ', ')" : 'no agent app running')
$rows = foreach ($from in $Plan.Keys) {
  $to = $Plan[$from]; $item = Get-Item $from -Force -ErrorAction SilentlyContinue
  $state = if (-not $item) { 'missing' } elseif ($item.LinkType) { 'already a link' } elseif (Test-Path $to) { 'target exists' } else { 'move' }
  [pscustomobject]@{ From = $from; To = $to; State = $state }
}
$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
if (-not $Apply) { Write-Host 'dry run: nothing changed. Rerun with -Apply after closing the apps.'; return }
if ($busy) { throw 'refusing to move while agent apps are running' }

New-Item -ItemType Directory -Force $AppsRoot, (Join-Path $Root 'Worktrees') | Out-Null
$wt = ($Root -replace '\\', '/') + '/Worktrees'
$done = [System.Collections.Generic.List[object]]::new()
if (Test-Path $Manifest) { (Get-Content $Manifest -Raw | ConvertFrom-Json) | ForEach-Object { $done.Add($_) } }
foreach ($r in $rows | Where-Object State -eq 'move') {
  try {
    New-Item -ItemType Directory -Force (Split-Path $r.To) | Out-Null
    [System.IO.Directory]::Move($r.From, $r.To)
    New-Item -ItemType Junction -Path $r.From -Target $r.To | Out-Null
    $done.Add([pscustomobject]@{ from = $r.From; to = $r.To; at = (Get-Date).ToString('o') })
    $done | ConvertTo-Json | Set-Content $Manifest
    Write-Host "moved  $($r.From) -> $($r.To)"
  } catch { Write-Host "FAILED $($r.From): $($_.Exception.Message) (left in place)" -ForegroundColor Red }
}

# Orca is closed here, so its settings file can be edited safely: new worktrees under the root, Hermes without --yolo.
$orcaData = Join-Path $AppsRoot 'orca-appdata\profiles\local-default\orca-data.json'
if (Test-Path $orcaData) {
  Copy-Item $orcaData "$orcaData.before-move-app-homes"
  node -e @"
const fs=require('fs');const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.settings.workspaceDir='$wt';
d.settings.workspaceDirHistory=[...new Set(['$wt',...(d.settings.workspaceDirHistory||[])])];
d.settings.agentDefaultArgs={...d.settings.agentDefaultArgs,hermes:'--checkpoints'};
fs.writeFileSync(p,JSON.stringify(d));console.log('orca: workspaceDir + hermes args set');
"@ $orcaData
}
Start-ScheduledTask -TaskName 'AgentMemory (unified-harness)' -ErrorAction SilentlyContinue
Write-Host "done. Manifest: $Manifest"
