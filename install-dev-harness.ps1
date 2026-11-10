#Requires -Version 7.0
<#
    install-dev-harness.ps1 - fresh-machine bootstrap for the Agentic Development Harness.

    Run this on a NEW Windows PC after copying this whole folder to it. Idempotent: running it
    again on a configured machine only fills what is missing.

    Messages are ASCII-only: console encoding on Windows is not reliable enough to print Turkish
    from every host.

    Usage:
      .\install-dev-harness.ps1                 # install everything missing
      .\install-dev-harness.ps1 -DryRun         # show what it would do, change nothing
      .\install-dev-harness.ps1 -SkipTools      # config only, assume the CLIs are already there
      .\install-dev-harness.ps1 -MemoryRoot D:\ai-memory

    What it does NOT do (you do these by hand, it tells you at the end):
      - log in to Claude Code / Codex
      - configure Pi provider credentials
      - install the Orca desktop app
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$SkipTools,
    [string]$MemoryRoot
)

$ErrorActionPreference = 'Continue'
$Here = $PSScriptRoot

$ClaudeHome = Join-Path $HOME '.claude'
$CodexHome  = Join-Path $HOME '.codex'
$PiHome     = Join-Path $HOME '.pi\agent'
$Manual     = [System.Collections.Generic.List[string]]::new()

function Write-Head($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  [ OK ] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  [FAIL] $t" -ForegroundColor Red }
function Info($t) { Write-Host "  [ .. ] $t" -ForegroundColor DarkGray }
function Step($what, [scriptblock]$do) {
    if ($DryRun) { Info "DRY-RUN would: $what"; return }
    Info $what
    & $do | Out-Null
}

function Use-LocalBin {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $lb      = Join-Path $HOME '.local\bin'
    $env:Path = (@($lb, $machine, $user, $env:Path) | Where-Object { $_ } | Join-String -Separator ';')
}
function Have($exe) { [bool](Get-Command $exe -ErrorAction SilentlyContinue) }

# ---------------------------------------------------------------- 0. prerequisites

Write-Head 'Prerequisites'
Ok "PowerShell $($PSVersionTable.PSVersion)"
if ($PSVersionTable.PSVersion.Major -lt 7) { Bad 'PowerShell 7+ required. Install it, then rerun.'; exit 1 }

$missingPrereq = @()
foreach ($p in @(
        @{ Exe = 'winget'; Hint = 'App Installer from the Microsoft Store' }
        @{ Exe = 'git';    Hint = 'https://git-scm.com/download/win' }
        @{ Exe = 'node';   Hint = 'https://nodejs.org (LTS)' }
        @{ Exe = 'npm';    Hint = 'ships with Node.js' }
    )) {
    if (Have $p.Exe) { Ok $p.Exe } else { Bad "$($p.Exe) missing - $($p.Hint)"; $missingPrereq += $p.Exe }
}
if ($missingPrereq.Count) { Bad "Install the missing prerequisites first: $($missingPrereq -join ', ')"; exit 1 }

# Python is only a tooling prerequisite (uv needs a runtime for Spec Kit / Graphify).
if (-not (Have 'py') -and -not (Have 'python3')) {
    Warn 'No Python found. uv will fetch its own, but Spec Kit and Graphify are faster with one installed.'
}

# ---------------------------------------------------------------- 1. harnesses

Write-Head 'Harnesses'

if (Have 'claude') { Ok "claude $(claude --version)" }
else {
    Step 'installing Claude Code (npm -g @anthropic-ai/claude-code)' { npm install -g '@anthropic-ai/claude-code' }
    Use-LocalBin
    if (Have 'claude') { Ok "claude $(claude --version)" } else { Bad 'Claude Code install failed'; }
    $Manual.Add('Claude Code: run `claude` once and sign in.')
}

# Codex: the desktop app ships the CLI in a hashed bin dir. Shim it rather than installing a second copy.
$codexApp = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
if (Have 'codex') { Ok "codex $(codex --version)" }
elseif (Test-Path $codexApp) {
    $shim = Join-Path $env:APPDATA 'npm\codex.cmd'
    Step "writing codex PATH shim -> $shim" {
        @'
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
'@ | Set-Content -Path $shim -Encoding ascii
    }
    if (Have 'codex') { Ok "codex $(codex --version) (shim)" }
} else {
    Step 'installing Codex CLI (npm -g @openai/codex)' { npm install -g '@openai/codex' }
    $Manual.Add('Codex: run `codex` once and sign in.')
}

if (Have 'pi') { Ok "pi $(pi --version)" }
else {
    Step 'installing Pi (npm -g @earendil-works/pi-coding-agent)' { npm install -g '@earendil-works/pi-coding-agent' }
}
$Manual.Add('Pi: it has no credentials until you add them. Check with: pi auth check --provider anthropic')

if (Have 'orca') { Ok "orca $(orca --version)" }
else { Warn 'Orca not found - optional. It is a desktop app, install it yourself if you want worktree/fleet UI.'; $Manual.Add('Orca (optional): install the desktop app from stablyai/orca.') }

# ---------------------------------------------------------------- 2. tools

if (-not $SkipTools) {
    Write-Head 'Tools'
    Use-LocalBin

    if (Have 'uv') { Ok "uv $(uv --version)" }
    else {
        Step 'installing uv (winget astral-sh.uv)' { winget install --id astral-sh.uv -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity }
        Use-LocalBin
    }

    if (Have 'rtk') { Ok "rtk $(rtk --version)" }
    else {
        Step 'installing RTK (winget rtk-ai.rtk)' { winget install --id rtk-ai.rtk -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity }
        Use-LocalBin
    }
    # crates.io has an unrelated 'rtk'. 'rtk gain' only exists on the right one.
    if (Have 'rtk') {
        $probe = rtk gain 2>&1 | Out-String
        if ($probe -match 'Token Savings|No tracking data') { Ok 'rtk verified (rtk gain works)' }
        else { Bad 'Wrong rtk on PATH (Rust Type Kit?). Uninstall it and install rtk-ai.rtk.' }
    }

    if (Have 'openspec') { Ok "openspec $(openspec --version)" }
    else { Step 'installing OpenSpec' { npm install -g '@fission-ai/openspec@latest' } }

    if (Have 'specify') { Ok "specify $(specify --version)" }
    else {
        Step 'installing Spec Kit' { uv tool install specify-cli --from 'git+https://github.com/github/spec-kit.git' }
        if (-not $DryRun) { uv tool update-shell | Out-Null }
        Use-LocalBin
    }

    if (Have 'graphify') { Ok "graphify $(graphify --version)" }
    else {
        # PyPI name is graphifyy while the graphify name is being reclaimed; the CLI is graphify.
        Step 'installing Graphify' { uv tool install graphifyy }
        Use-LocalBin
    }
}

# ---------------------------------------------------------------- 3. graphify skill per harness

Write-Head 'Graphify skill'
Use-LocalBin
if (Have 'graphify') {
    foreach ($plat in 'claude', 'codex', 'pi') {
        Step "graphify install --platform $plat" { graphify install --platform $plat }
    }
    if (-not $DryRun) { Ok 'installed for claude, codex, pi' }
} else { Warn 'graphify not on PATH, skipped' }

# ---------------------------------------------------------------- 4. global CLAUDE.md

Write-Head 'Global CLAUDE.md'
$claudeMd = Join-Path $ClaudeHome 'CLAUDE.md'
$seed = Join-Path $Here 'templates\CLAUDE.md'
if (-not (Test-Path $ClaudeHome)) { New-Item -ItemType Directory -Force -Path $ClaudeHome | Out-Null }

if (-not (Test-Path $claudeMd)) {
    if (Test-Path $seed) {
        Step "seeding $claudeMd from templates\CLAUDE.md" { Copy-Item $seed $claudeMd }
        Ok 'seeded - edit it, it is yours'
    } else { Warn 'no CLAUDE.md and no template to seed from' }
} elseif ((Get-Content $claudeMd -Raw) -match 'narvai-orchestrator') {
    Ok 'already points at narvai-orchestrator'
} else {
    $ptr = @"

# Development

Non-trivial her gelistirme isteginde ``narvai-orchestrator`` skill'ini cagir. Rota, spec sahipligi,
context butcesi ve dis store yonetimi oradan gelir. Proje-yerel kurallar her generic skill'i ezer.

Repo'ya harness defteri yazilmaz: ``.ai/``, ``.gitignore`` satiri, ``graphify-out/`` proje agacina konmaz.
Store yolu: ``setup-dev-harness.ps1 -Where <repo>``.
"@
    Step "appending a narvai-orchestrator pointer to $claudeMd (existing content kept)" {
        Copy-Item $claudeMd "$claudeMd.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Add-Content $claudeMd $ptr -Encoding utf8
    }
}

# ---------------------------------------------------------------- 5. hand off to setup

Write-Head 'Configuration'
$setup = Join-Path $Here 'setup-dev-harness.ps1'
if (-not (Test-Path $setup)) { Bad "setup-dev-harness.ps1 not found next to this script"; exit 1 }

if ($MemoryRoot) {
    [Environment]::SetEnvironmentVariable('AI_HARNESS_MEMORY', $MemoryRoot, 'User')
    $env:AI_HARNESS_MEMORY = $MemoryRoot
    Ok "memory root pinned to $MemoryRoot (user env var AI_HARNESS_MEMORY)"
}

if ($DryRun) {
    Info 'DRY-RUN would run: setup-dev-harness.ps1 -Install'
    Info 'DRY-RUN would run: setup-dev-harness.ps1 -StoreHook On'
} else {
    & $setup -Install
    & $setup -StoreHook On
}

# ---------------------------------------------------------------- 6. what is left for you

Write-Head 'Manual steps left for you'
$Manual.Add('Restart your terminal so new PATH entries resolve.')
$Manual.Add('Restart the Claude Code session so plugin and hook changes take effect.')
$Manual.Add('Onboard each repo you work in:  .\setup-dev-harness.ps1 -Project <repo path>')
$Manual.Add('Build its code graph once:       .\setup-dev-harness.ps1 -Graph   <repo path>')
$i = 1
foreach ($m in $Manual) { Write-Host ("  {0}. {1}" -f $i, $m); $i++ }

Write-Host ''
Write-Host '  Read KULLANIM.md for day-to-day use.' -ForegroundColor Cyan
Write-Host ''
