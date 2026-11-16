#Requires -Version 7.0
<#
    setup-dev-harness.ps1 - idempotent installer / verifier / repairer for the
    Agentic Development Harness v4.0.

    Messages are ASCII-only on purpose: console encoding on Windows is not reliable
    enough to print Turkish safely from every host.

    Usage:
      .\setup-dev-harness.ps1 -Check
      .\setup-dev-harness.ps1 -Install
      .\setup-dev-harness.ps1 -Update
      .\setup-dev-harness.ps1 -Repair
      .\setup-dev-harness.ps1 -Sync
      .\setup-dev-harness.ps1 -Project C:\path\to\repo    # create the EXTERNAL .ai store
      .\setup-dev-harness.ps1 -Where   C:\path\to\repo    # print where that store is
      .\setup-dev-harness.ps1 -Graph   C:\path\to\repo    # build the code graph into the store
      .\setup-dev-harness.ps1 -HeavyMode On|Off
      .\setup-dev-harness.ps1 -RtkHook   On|Off
      .\setup-dev-harness.ps1 -StoreHook On|Off           # auto-activate the store at session start

    Nothing is ever written inside a repository: no .ai/, no .gitignore edits.
    Stores live under $env:AI_HARNESS_MEMORY, default C:\Projects\AI\Features\_harness, named after the project.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Install,
    [switch]$Update,
    [switch]$Repair,
    [switch]$Sync,
    [string]$Project,
    [string]$Where,
    [string]$Graph,
    [ValidateSet('On', 'Off')][string]$HeavyMode,
    [ValidateSet('On', 'Off')][string]$RtkHook,
    [ValidateSet('On', 'Off')][string]$StoreHook
)

$ErrorActionPreference = 'Continue'

# Memory lives OUTSIDE every repository. Nothing is written into a project tree.
# Override with $env:AI_HARNESS_MEMORY; default is <script dir>\memory.
$MemoryRoot = if ($env:AI_HARNESS_MEMORY) { $env:AI_HARNESS_MEMORY } else { 'C:\Projects\AI\Features\_harness' }
$MemoryMap  = Join-Path $MemoryRoot 'map.json'

$ClaudeHome = Join-Path $HOME '.claude'
$CodexHome  = Join-Path $HOME '.codex'
$PiHome     = Join-Path $HOME '.pi\agent'
$SkillName  = 'narvai-orchestrator'
# One source of truth: the copy in this folder. Claude, Codex and Pi all get synced copies.
$SkillSrc   = Join-Path $PSScriptRoot "skills\$SkillName"
$BackupRoot = Join-Path $ClaudeHome 'backups'

function Write-Head($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)         { Write-Host "  [ OK ] $t" -ForegroundColor Green }
function Warn($t)       { Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Bad($t)        { Write-Host "  [FAIL] $t" -ForegroundColor Red }
function Info($t)       { Write-Host "  [ .. ] $t" -ForegroundColor DarkGray }

function Use-LocalBin {
    # winget and uv write PATH to the registry; this session's copy can be stale.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $lb      = Join-Path $HOME '.local\bin'
    $env:Path = (@($lb, $machine, $user, $env:Path) | Where-Object { $_ } | Join-String -Separator ';')
}

function Get-ToolVersion([string]$exe, [string[]]$verArgs) {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { return $null }
    try { (& $exe @verArgs 2>&1 | Select-Object -First 1) -replace '\s+', ' ' } catch { $null }
}

function Backup-File([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    $dir = Join-Path $BackupRoot ('harness-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $dest = Join-Path $dir (Split-Path $path -Leaf)
    Copy-Item $path $dest -Force
    return $dest
}

# ---------------------------------------------------------------- components

$Components = @(
    @{ Name = 'claude';   Exe = 'claude';   Args = @('--version'); Source = 'npm @anthropic-ai/claude-code'; Install = $null }
    @{ Name = 'codex';    Exe = 'codex';    Args = @('--version'); Source = 'OpenAI Codex app + PATH shim';  Install = $null }
    @{ Name = 'pi';       Exe = 'pi';       Args = @('--version'); Source = 'npm @earendil-works/pi-coding-agent'; Install = { npm install -g '@earendil-works/pi-coding-agent' } }
    @{ Name = 'orca';     Exe = 'orca';     Args = @('--version'); Source = 'stablyai/orca (desktop)';        Install = $null }
    @{ Name = 'openspec'; Exe = 'openspec'; Args = @('--version'); Source = 'npm @fission-ai/openspec';       Install = { npm install -g '@fission-ai/openspec@latest' } }
    @{ Name = 'specify';  Exe = 'specify';  Args = @('--version'); Source = 'github/spec-kit via uv';         Install = { uv tool install specify-cli --from 'git+https://github.com/github/spec-kit.git' } }
    @{ Name = 'graphify'; Exe = 'graphify'; Args = @('--version'); Source = 'PyPI graphifyy via uv';          Install = { uv tool install graphifyy } }
    @{ Name = 'rtk';      Exe = 'rtk';      Args = @('--version'); Source = 'winget rtk-ai.rtk';              Install = { winget install --id rtk-ai.rtk -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity } }
    @{ Name = 'uv';       Exe = 'uv';       Args = @('--version'); Source = 'winget astral-sh.uv';            Install = { winget install --id astral-sh.uv -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity } }
    @{ Name = 'node';     Exe = 'node';     Args = @('--version'); Source = 'nodejs.org';                     Install = $null }
    @{ Name = 'git';      Exe = 'git';      Args = @('--version'); Source = 'git-scm.com';                    Install = $null }
)

$ClaudePlugins = @(
    @{ Id = 'agent-skills@addy-agent-skills'; Market = 'addyosmani/agent-skills'; Want = $true  }
    @{ Id = 'ponytail@ponytail';              Market = 'DietrichGebert/ponytail'; Want = $true  }
    @{ Id = 'pstack@pstack-claude';           Market = 'michael-denyer/pstack-claude'; Want = $true }
    @{ Id = 'csharp-lsp@claude-plugins-official';     Market = $null; Want = $true }
    @{ Id = 'typescript-lsp@claude-plugins-official'; Market = $null; Want = $true }
    # Heavy Mode - installed but off the default route by design
    @{ Id = 'superpowers@claude-plugins-official';    Market = $null; Want = $false }
)

# ---------------------------------------------------------------- actions

function Invoke-ToolCheck([bool]$doInstall) {
    Write-Head 'Tools'
    Use-LocalBin
    foreach ($c in $Components) {
        $v = Get-ToolVersion $c.Exe $c.Args
        if ($v) { Ok ("{0,-9} {1}" -f $c.Name, $v); continue }
        if (-not $doInstall) { Bad ("{0,-9} missing  ({1})" -f $c.Name, $c.Source); continue }
        if ($null -eq $c.Install) { Bad ("{0,-9} missing, manual install required ({1})" -f $c.Name, $c.Source); continue }
        Info "installing $($c.Name) ..."
        & $c.Install | Out-Null
        Use-LocalBin
        $v = Get-ToolVersion $c.Exe $c.Args
        if ($v) { Ok ("{0,-9} {1}" -f $c.Name, $v) } else { Bad ("{0,-9} install did not put it on PATH" -f $c.Name) }
    }
}

function Set-CodexShim {
    Write-Head 'Codex PATH shim'
    $shim = Join-Path $env:APPDATA 'npm\codex.cmd'
    if (Get-Command codex -ErrorAction SilentlyContinue) { Ok "codex resolves on PATH"; return }
    $body = @'
@echo off
setlocal
set "CODEX_EXE="
for /f "delims=" %%I in ('dir /b /o-d "%LOCALAPPDATA%\OpenAI\Codex\bin\*" 2^>nul') do (
  if exist "%LOCALAPPDATA%\OpenAI\Codex\bin\%%I\codex.exe" (
    set "CODEX_EXE=%LOCALAPPDATA%\OpenAI\Codex\bin\%%I\codex.exe"
    goto :run
  )
)
:run
if not defined CODEX_EXE (
  echo codex.exe not found under %%LOCALAPPDATA%%\OpenAI\Codex\bin 1>&2
  exit /b 1
)
"%CODEX_EXE%" %*
'@
    Set-Content -Path $shim -Value $body -Encoding ascii
    if (Get-Command codex -ErrorAction SilentlyContinue) { Ok "shim written: $shim" } else { Warn "shim written but codex still not resolving: $shim" }
}

function Invoke-PluginCheck([bool]$apply) {
    Write-Head 'Claude Code plugins'
    $settings = Join-Path $ClaudeHome 'settings.json'
    if (-not (Test-Path $settings)) { Bad "settings.json not found"; return }
    $enabled = (Get-Content $settings -Raw | ConvertFrom-Json).enabledPlugins
    foreach ($p in $ClaudePlugins) {
        $have = $false
        if ($enabled -and $enabled.PSObject.Properties.Name -contains $p.Id) { $have = [bool]$enabled.$($p.Id) }
        $label = if ($p.Want) { 'should be ON' } else { 'should be OFF (Heavy Mode)' }
        if ($have -eq $p.Want) { Ok ("{0,-45} {1}" -f $p.Id, ($(if($have){'on'}else{'off'}))); continue }
        Warn ("{0,-45} {1}" -f $p.Id, $label)
        if (-not $apply) { continue }
        if ($p.Market -and -not ($enabled.PSObject.Properties.Name -contains $p.Id)) {
            Info "adding marketplace $($p.Market)"
            claude plugin marketplace add $p.Market 2>&1 | Out-Null
            claude plugin install $p.Id 2>&1 | Out-Null
        }
        if ($p.Want) { claude plugin enable $p.Id 2>&1 | Out-Null } else { claude plugin disable $p.Id 2>&1 | Out-Null }
    }
}

function Set-PstackLean {
    Write-Head 'pstack lean mode (no auto-routing)'
    foreach ($sheet in @((Join-Path $ClaudeHome 'pstack-models.md'), (Join-Path $CodexHome 'pstack-models.md'))) {
        $parent = Split-Path $sheet -Parent
        if (-not (Test-Path $parent)) { Info "skip (no $parent)"; continue }
        $needs = $true
        if (Test-Path $sheet) { $needs = -not ((Get-Content $sheet) -match '^session hook: off$') }
        if ($needs) {
            Backup-File $sheet | Out-Null
            Set-Content -Path $sheet -Value "# pstack sheet`n`nsession hook: off`n" -Encoding utf8
            Ok "wrote 'session hook: off' -> $sheet"
        } else { Ok "already off -> $sheet" }
    }
    Info "arena / swarm / architect / blast-radius stay installed but Heavy-Mode only"
}

function Set-HeavyModeState([string]$state) {
    Write-Head "Heavy Mode -> $state"
    if ($state -eq 'On') {
        claude plugin enable 'superpowers@claude-plugins-official' 2>&1 | Out-Null
        Ok 'superpowers enabled - restart the session to load it'
        Warn 'Heavy Mode is opt-in. Turn it back off when the work is done.'
    } else {
        claude plugin disable 'superpowers@claude-plugins-official' 2>&1 | Out-Null
        Ok 'superpowers disabled - installed, off the default route'
    }
}

function Set-RtkHookState([string]$state) {
    Write-Head "RTK transparent hook -> $state"
    $settings = Join-Path $ClaudeHome 'settings.json'
    if ($state -eq 'On') {
        Warn 'Orca owns every hook point in settings.json. rtk init -g patches PreToolUse.'
        $b = Backup-File $settings
        Info "backup: $b"
        rtk init -g --hook-only
        Warn 'Verify Orca still works (statusline, agent panes). Restore the backup if it does not.'
    } else {
        Ok 'Not installing the hook. Use explicit: rtk <command>'
        Info "To undo an earlier hook install, restore a settings.json backup from $BackupRoot"
    }
}

function Set-StoreHookState([string]$state) {
    Write-Head 'AI store hook'
    Info 'Claude hooks (store context, guard, graph) are registered by: node narvai.mjs install'
    & node (Join-Path $PSScriptRoot 'narvai.mjs') install
}

function Sync-Orchestrator {
    Write-Head 'narvai sync (node narvai.mjs sync)'
    & node (Join-Path $PSScriptRoot 'narvai.mjs') sync
}
function Sync-HouseRules { }
function Add-CodexPointer { }

function Read-MemoryMap {
    $map = @{}
    if (Test-Path $MemoryMap) {
        (Get-Content $MemoryMap -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $map[$_.Name] = $_.Value }
    }
    $map
}

# Store folders are named after the project, not the path. A second repo with the same
# folder name gets a short path-hash suffix; map.json stays the authority either way.
function Get-StoreKey([string]$repoPath) {
    $full = (Resolve-Path $repoPath).Path.TrimEnd('\')
    $name = Split-Path $full -Leaf
    $map  = Read-MemoryMap
    foreach ($k in $map.Keys) {
        if ($k -eq $full) { return (Split-Path $map[$k] -Leaf) }
    }
    $taken = $map.Values | ForEach-Object { Split-Path $_ -Leaf }
    if (($taken -contains $name) -or ((Test-Path (Join-Path $MemoryRoot $name)) -and -not ($map.Keys -contains $full))) {
        $md5 = [Security.Cryptography.MD5]::Create()
        $h = [BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($full.ToLower()))).Replace('-', '').Substring(0, 6).ToLower()
        return "$name-$h"
    }
    $name
}

function Get-AiStore([string]$repoPath) {
    Join-Path $MemoryRoot (Get-StoreKey $repoPath)
}

function Update-MemoryMap([string]$repoPath, [string]$store) {
    New-Item -ItemType Directory -Force -Path $MemoryRoot | Out-Null
    $map = Read-MemoryMap
    $map[(Resolve-Path $repoPath).Path.TrimEnd('\')] = $store
    $map | ConvertTo-Json -Depth 3 | Set-Content $MemoryMap -Encoding utf8
}

function Show-AiStore([string]$repoPath) {
    Write-Head 'AI store location'
    if (-not (Test-Path $repoPath)) { Bad 'path does not exist'; return }
    $store = Get-AiStore $repoPath
    Write-Host "  repo  : $((Resolve-Path $repoPath).Path)"
    Write-Host "  store : $store"
    if (Test-Path $store) { Ok 'store exists' } else { Warn "not onboarded yet - run: -Project `"$repoPath`"" }
    Write-Host "  map   : $MemoryMap"
}

function Update-RepoGraph([string]$repoPath) {
    Write-Head "Graphify code-only index: $repoPath"
    if (-not (Test-Path $repoPath)) { Bad 'path does not exist'; return }
    Use-LocalBin
    if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) { Bad 'graphify not on PATH'; return }

    $store = Get-AiStore $repoPath
    $dest  = Join-Path $store 'graphify'
    $tmp   = Join-Path (Resolve-Path $repoPath).Path 'graphify-out'

    # graphify update has no --out; it always writes <path>\graphify-out.
    # Build there, then move the result into the external store so the repo stays clean.
    if (Test-Path $tmp) { Bad "graphify-out already exists in the repo - refusing to touch it: $tmp"; return }
    New-Item -ItemType Directory -Force -Path $store | Out-Null
    try {
        if (Test-Path $dest) { Move-Item $dest $tmp -Force; Info 'restored previous index for incremental update' }
        graphify update $repoPath --no-cluster
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Move-Item $tmp $dest -Force
        Ok "index -> $dest"
        Info "query with: graphify query `"...`" --budget 500 --graph `"$dest\graph.json`""
    } finally {
        if (Test-Path $tmp) { Warn "leftover in repo, moving out: $tmp"; Move-Item $tmp $dest -Force -ErrorAction SilentlyContinue }
    }
    $st = git -C $repoPath status --porcelain 2>$null
    if ($st) { Warn "repo is not clean after indexing:`n$st" } else { Ok 'repo working tree clean' }
}

function Initialize-ProjectMemory([string]$path) {
    Write-Head "Project onboarding (external store): $path"
    if (-not (Test-Path $path)) { Bad 'path does not exist'; return }
    $ai = Get-AiStore $path
    foreach ($d in @($ai, (Join-Path $ai 'decisions'), (Join-Path $ai 'lessons'), (Join-Path $ai 'work'), (Join-Path $ai 'runtime'))) {
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    }

    $index = Join-Path $ai 'index.md'
    if (-not (Test-Path $index)) {
        @"
# AI store

Cross-harness memory and work state for:

    $((Resolve-Path $path).Path)

This store lives **outside** the repository on purpose. Nothing here is written into the project
tree and nothing is added to its .gitignore. Claude, Codex and Pi all read this. Chat history is
not the source of truth.

| Path | Holds |
|---|---|
| project-profile.md | derived navigation card (<= 1,200 tokens) |
| requirements.md | durable cross-feature product intent |
| invariants.md | high-value rules that are easy to forget |
| decisions/ | ADRs |
| lessons/ | curated reusable findings |
| work/<id>/state.yaml | active work checkpoint |
| runtime/ | estimates, locks, session ids |
| graphify/ | code graph index (graph.json) |

Canonical feature specs live in the spec system (openspec/ or specs/) inside the repo, or here
under the work item if the repo must stay untouched. Link, never copy.

Because this store is not versioned with the repo, it is not automatically backed up. Treat
requirements/invariants/decisions as the durable part and back this folder up yourself.
"@ | Set-Content $index -Encoding utf8
        Ok 'created index.md'
    } else { Ok 'index.md already present' }

    $profile = Join-Path $ai 'project-profile.md'
    if (-not (Test-Path $profile)) {
        @"
# Project profile

> Derived navigation card. Not a replacement for CLAUDE.md / AGENTS.md.
> Target <= 1,200 tokens. Every derived rule cites its source. Refresh only when sources change.

Stack:
Authoritative instruction files:
Build:
Test:
Lint / typecheck:
Architectural boundaries:
DB / migration rules:
Pattern examples:
Tests live in:
Protected / high-risk areas:
Navigation tools:
"@ | Set-Content $profile -Encoding utf8
        Ok 'created project-profile.md (stub - fill from real sources)'
    } else { Ok 'project-profile.md already present' }

    foreach ($pair in @(@('requirements.md', "# Requirements ledger`n`n> Durable cross-feature intent only. Feature-local acceptance criteria stay in the canonical spec.`n> R-nnn - text / Status: accepted|exploring|superseded / Related spec: path`n"),
                        @('invariants.md',   "# Invariants`n`n> High-value rules that are easy to forget and materially constrain implementation.`n> Cite the source for each. Do not duplicate AGENTS.md / CLAUDE.md wholesale.`n"))) {
        $f = Join-Path $ai $pair[0]
        if (-not (Test-Path $f)) { Set-Content $f $pair[1] -Encoding utf8; Ok "created $($pair[0])" }
    }

    Update-MemoryMap $path $ai
    Ok "store : $ai"
    Ok "map   : $MemoryMap"

    $st = git -C $path status --porcelain 2>$null
    if ($st) { Warn "repo working tree is NOT clean:`n$st" } else { Ok 'repo untouched - working tree clean' }
}

function Show-Health {
    Write-Head 'Health report'
    Use-LocalBin
    foreach ($c in $Components) {
        $v = Get-ToolVersion $c.Exe $c.Args
        if ($v) { Ok ("{0,-9} {1,-34} {2}" -f $c.Name, $v, $c.Source) } else { Bad ("{0,-9} MISSING {1}" -f $c.Name, $c.Source) }
    }
    Write-Head 'Policy switches'
    $sheet = Join-Path $ClaudeHome 'pstack-models.md'
    if ((Test-Path $sheet) -and ((Get-Content $sheet) -match '^session hook: off$')) { Ok 'pstack auto-routing: OFF' } else { Warn 'pstack auto-routing: ON (expected OFF)' }
    $settings = Join-Path $ClaudeHome 'settings.json'
    $raw = Get-Content $settings -Raw
    if ($raw -match '"superpowers@claude-plugins-official":\s*false') { Ok 'Superpowers: installed, off default route' } else { Warn 'Superpowers: ON the default route (expected off)' }
    if ($raw -match 'rtk') { Warn 'settings.json mentions rtk - transparent hook may be installed' } else { Ok 'RTK: explicit mode, Orca hooks untouched' }
    if ($raw -match '"agent-skills@addy-agent-skills":\s*true') { Ok 'Addy agent-skills: enabled' } else { Warn 'Addy agent-skills: disabled (expected enabled)' }
    if ($raw -match 'store-context') { Ok 'AI store hook: registered (store activates on session start)' } else { Warn 'AI store hook: not registered - run -StoreHook On' }
    Write-Head 'Shared skill'
    Info "source: $SkillSrc"
    foreach ($p in @((Join-Path $ClaudeHome "skills\$SkillName"), (Join-Path $CodexHome "skills\$SkillName"), (Join-Path $PiHome "skills\$SkillName"))) {
        if (Test-Path (Join-Path $p 'SKILL.md')) { Ok $p } else { Warn "missing: $p" }
    }
    Write-Head 'On-demand only (not installed by design)'
    Info 'AAS Core   : npx agentic-awesome-skills --skills <name> --dry-run'
    Info "Obsidian   : disabled; the external store is the durable memory"
    Info "Memory root: $MemoryRoot"
}

# ---------------------------------------------------------------- dispatch

if (-not ($Check -or $Install -or $Update -or $Repair -or $Sync -or $Project -or $Where -or $Graph -or $HeavyMode -or $RtkHook -or $StoreHook)) { $Check = $true }

if ($HeavyMode) { Set-HeavyModeState $HeavyMode }
if ($RtkHook)   { Set-RtkHookState  $RtkHook   }
if ($StoreHook) { Set-StoreHookState $StoreHook }

if ($Check)   { Invoke-ToolCheck $false; Invoke-PluginCheck $false; Show-Health }
if ($Install) { Invoke-ToolCheck $true;  Set-CodexShim; Invoke-PluginCheck $true; Set-PstackLean; Sync-Orchestrator; Sync-HouseRules; Add-CodexPointer; Show-Health }
if ($Update)  { Invoke-ToolCheck $true;  Invoke-PluginCheck $true;  Set-PstackLean; Sync-Orchestrator; Sync-HouseRules; Show-Health }
if ($Repair)  { Set-CodexShim; Invoke-PluginCheck $true; Set-PstackLean; Sync-Orchestrator; Sync-HouseRules; Add-CodexPointer; Show-Health }
if ($Sync)    { Sync-Orchestrator; Sync-HouseRules }
if ($Project) { Initialize-ProjectMemory $Project }
if ($Where)   { Show-AiStore $Where }
if ($Graph)   { Update-RepoGraph $Graph }

Write-Host ''
