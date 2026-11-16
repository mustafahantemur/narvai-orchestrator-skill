// narvai setup: one shared harness for Hermes, Claude Code, Codex, Antigravity and Orca. Idempotent; rerun after
// installing a tool, a Claude plugin update or an AgentMemory upgrade. Loaded by `node narvai.mjs setup`.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(3);
const DRY = argv.includes('--dry-run');
const WIN = process.platform === 'win32';
const HOME = homedir();
const AGENTMEMORY_URL = 'http://localhost:3111';
const MEMORY_AGENT_ID = 'shared-dev';
const ADO_READ_ONLY = ['*_write', 'pipelines_run', 'repo_create_branch', 'wiki_upsert_page'];
const todo = [];

function step(name, fn) {
  try { const r = fn(); console.log(`  ${r === false ? 'SKIP' : 'OK  '} ${name}${typeof r === 'string' ? ` (${r})` : ''}`); }
  catch (e) { console.log(`  FAIL ${name}: ${String(e.message ?? e).split('\n')[0]}`); }
}

function which(name) {
  const r = spawnSync(WIN ? 'where' : 'which', [name], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const hits = r.stdout.split(/\r?\n/).filter(Boolean);
  return hits.find((h) => /\.exe$/i.test(h)) ?? hits.find((h) => /\.cmd$/i.test(h)) ?? hits[0];
}

const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
function run(cmd, args, opts = {}) {
  if (DRY && !opts.readOnly) { console.log(`       DRY ${cmd} ${args.join(' ')}`); return opts.allowFail ? { status: 0, stdout: '' } : ''; }
  const exe = which(cmd) ?? cmd;
  const r = /\.(cmd|bat)$/i.test(exe)
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${[exe, ...args].map(quote).join(' ')}"`], { encoding: 'utf8', windowsVerbatimArguments: true, ...opts })
    : spawnSync(exe, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  return opts.allowFail ? r : r.stdout;
}

function junction(target, path) {
  try { if (realpathSync(path) === realpathSync(target)) return false; } catch {}
  if (DRY) { console.log(`       DRY link ${path} -> ${target}`); return true; }
  if (lstatSync(path, { throwIfNoEntry: false })) rmdirSync(path);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'junction');
  return true;
}

function backup(file) {
  if (!existsSync(file)) return;
  const dir = join(HOME, '.narvai', 'backups');
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, join(dir, `${file.split(/[\\/]/).slice(-2).join('_')}.${Date.now()}`));
}

function upsertEnv(file, pairs) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let out = text, changed = [];
  for (const [k, v] of Object.entries(pairs)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(out)) { if (!out.match(re)[0].endsWith(`=${v}`)) { out = out.replace(re, `${k}=${v}`); changed.push(k); } }
    else { out = out.replace(/\s*$/, eol) + `${k}=${v}${eol}`; changed.push(k); }
  }
  if (changed.length && !DRY) { backup(file); writeFileSync(file, out); }
  return changed.length ? `set ${changed.join(', ')}` : 'current';
}

function editJson(file, mutate) {
  const raw = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  const data = raw ? JSON.parse(raw) : {};
  const before = JSON.stringify(data);
  mutate(data);
  if (JSON.stringify(data) === before) return 'current';
  if (!DRY) { backup(file); writeFileSync(file, raw.includes('\n') || !raw ? JSON.stringify(data, null, 2) + '\n' : JSON.stringify(data)); }
  return 'updated';
}

const cfgPath = join(HOME, '.narvai', 'config.json');
const readCfg = () => (existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {});
const native = (p) => (WIN ? p.replace(/\//g, '\\') : p);

console.log('narvai setup' + (DRY ? ' (dry run)' : ''));
if (!DRY) {
  const pass = argv.filter((a, i) => a === '--root' || argv[i - 1] === '--root');
  const r = spawnSync(process.execPath, [join(HARNESS, 'narvai.mjs'), 'install', '--adopt', ...pass], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const cfg = readCfg();
const root = cfg.aiRoot ?? 'C:/Projects/AI';
const npmRoot = (() => { try { return run('npm', ['root', '-g'], { readOnly: true }).trim() || null; } catch { return null; } })();
const amPackage = npmRoot && join(npmRoot, '@agentmemory', 'agentmemory');
const amCli = amPackage && join(amPackage, 'dist', 'cli.mjs').replace(/\\/g, '/');
const hermesHome = process.env.HERMES_HOME || (WIN ? join(process.env.LOCALAPPDATA ?? join(HOME, 'AppData', 'Local'), 'hermes') : join(HOME, '.hermes'));

console.log('AgentMemory');
const amEnv = join(HOME, '.agentmemory', '.env');
if (!which('agentmemory')) { console.log('  SKIP not installed'); todo.push('npm install -g @agentmemory/agentmemory@0.9.33, then rerun setup'); }
else {
  step('~/.agentmemory/.env', () => {
    if (!existsSync(amEnv)) run('agentmemory', ['init']);
    return upsertEnv(amEnv, { EMBEDDING_PROVIDER: 'local', AGENTMEMORY_TOOLS: 'core', AGENTMEMORY_DATA_DIR: native(`${root}/Memory/agentmemory`), AGENT_ID: MEMORY_AGENT_ID });
  });
  if (WIN) step('logon task "AgentMemory (unified-harness)"', () => {
    if (run('schtasks', ['/query', '/tn', 'AgentMemory (unified-harness)'], { allowFail: true, readOnly: true }).status === 0) return 'exists';
    const ps = `$a=New-ScheduledTaskAction -Execute (Get-Command pwsh,powershell -ErrorAction SilentlyContinue | Select-Object -First 1).Source -Argument "-NoProfile -WindowStyle Hidden -Command & '${which('agentmemory')}' *> '${join(HOME, '.agentmemory', 'server.log')}'";`
      + `$t=New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME";`
      + `$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10);`
      + `Register-ScheduledTask -TaskName 'AgentMemory (unified-harness)' -Action $a -Trigger $t -Settings $s | Out-Null`;
    run('powershell', ['-NoProfile', '-Command', ps]);
    return 'created';
  });
  step('server reachable', () => {
    const live = () => run('curl', ['-fsS', `${AGENTMEMORY_URL}/agentmemory/livez`], { allowFail: true }).status === 0;
    if (DRY || live()) return 'live';
    if (WIN) run('schtasks', ['/run', '/tn', 'AgentMemory (unified-harness)']);
    else spawnSync('agentmemory', [], { detached: true, stdio: 'ignore' });
    for (let i = 0; i < 60 && !live(); i++) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
    if (!live()) throw new Error('not live after 120 s; see ~/.agentmemory/server.log');
    return 'started';
  });
  const mcpEnv = { AGENTMEMORY_URL, AGENTMEMORY_FORCE_PROXY: '1' };
  if (which('claude')) step('Claude Code MCP agentmemory', () => {
    if (run('claude', ['mcp', 'get', 'agentmemory'], { allowFail: true, readOnly: true }).status === 0) return 'exists';
    run('claude', ['mcp', 'add', 'agentmemory', '--scope', 'user', ...Object.entries(mcpEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]), '--', 'node', amCli, 'mcp']);
    return 'added';
  });
  if (which('codex')) step('Codex MCP agentmemory', () => {
    if (run('codex', ['mcp', 'get', 'agentmemory'], { allowFail: true, readOnly: true }).status === 0) return 'exists';
    run('codex', ['mcp', 'add', 'agentmemory', ...Object.entries(mcpEnv).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--', 'node', amCli, 'mcp']);
    return 'added';
  });
  const agy = join(HOME, '.gemini', 'config');
  if (existsSync(agy)) step('Antigravity MCP agentmemory', () => editJson(join(agy, 'mcp_config.json'), (d) => {
    d.mcpServers ??= {};
    d.mcpServers.agentmemory ??= { command: 'node', args: [amCli, 'mcp'], env: mcpEnv };
  }));
}

console.log('Hermes');
if (!which('hermes')) { console.log('  SKIP not installed'); todo.push('install Hermes: iex (irm https://hermes-agent.nousresearch.com/install.ps1), then rerun setup'); }
else {
  const hset = (k, v) => run('hermes', ['config', 'set', k, v]);
  if (WIN) step('HERMES_HOME user variable (Orca reads it)', () => {
    if (process.env.HERMES_HOME === hermesHome) return 'current';
    run('setx', ['HERMES_HOME', hermesHome]);
    return hermesHome;
  });
  step('Claude/Codex logins are not borrowed', () => { hset('auth.adopt_external_logins', 'false'); });
  const view = join(hermesHome, 'plugin-skills');
  step('Claude plugin skills view', () => {
    const settings = JSON.parse(readFileSync(join(HOME, '.claude', 'settings.json'), 'utf8'));
    const installed = JSON.parse(readFileSync(join(HOME, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins;
    const want = new Map();
    for (const [id, on] of Object.entries(settings.enabledPlugins ?? {})) {
      const base = on && installed[id]?.[0]?.installPath;
      if (!base) continue;
      const name = id.split('@')[0];
      const manifest = join(base, '.claude-plugin', 'plugin.json');
      const declared = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).skills : undefined;
      const list = Array.isArray(declared) ? declared : [declared ?? './skills'];
      for (const rel of list) {
        const dir = join(base, rel);
        if (!existsSync(dir)) continue;
        want.set(Array.isArray(declared) ? join(view, name, rel.split('/').pop()) : join(view, name), dir);
      }
    }
    let changed = 0;
    for (const [path, target] of want) if (junction(target, path)) changed++;
    const keep = new Set([...want.keys()].flatMap((p) => [p, dirname(p)]));
    for (const top of existsSync(view) ? readdirSync(view) : []) {
      for (const p of [join(view, top), ...(lstatSync(join(view, top)).isSymbolicLink() ? [] : readdirSync(join(view, top)).map((c) => join(view, top, c)))]) {
        if (!keep.has(p) && lstatSync(p).isSymbolicLink() && !DRY) { rmdirSync(p); changed++; }
      }
    }
    return `${want.size} entries, ${changed} changed`;
  });
  step('skills.external_dirs', () => {
    hset('skills.external_dirs', JSON.stringify([join(HARNESS, 'skills'), join(HARNESS, 'third-party', 'skills'), view].map((p) => p.replace(/\\/g, '/'))));
  });
  if (amPackage && existsSync(join(amPackage, 'integrations', 'hermes'))) {
    step('AgentMemory memory provider', () => {
      junction(join(amPackage, 'integrations', 'hermes'), join(hermesHome, 'plugins', 'agentmemory'));
      run('hermes', ['plugins', 'enable', 'agentmemory'], { allowFail: true });
      hset('memory.provider', 'agentmemory');
      const secretFile = join(HOME, '.agentmemory', 'secret');
      const pairs = { AGENTMEMORY_AGENT_ID: MEMORY_AGENT_ID };
      if (existsSync(secretFile)) pairs.AGENTMEMORY_SECRET = readFileSync(secretFile, 'utf8').trim();
      else todo.push('start AgentMemory once, then rerun setup so Hermes gets its local secret');
      return upsertEnv(join(hermesHome, '.env'), pairs);
    });
  }
  step('MCP context7', () => { hset('mcp_servers.context7.url', 'https://mcp.context7.com/mcp'); });
  if (cfg.adoOrg && npmRoot && existsSync(join(npmRoot, '@azure-devops', 'mcp', 'dist', 'index.js'))) step(`MCP azure-devops (${cfg.adoOrg}, read-only)`, () => {
    hset('mcp_servers.azure-devops.command', 'node');
    hset('mcp_servers.azure-devops.args', JSON.stringify([join(npmRoot, '@azure-devops', 'mcp', 'dist', 'index.js').replace(/\\/g, '/'), cfg.adoOrg, '--authentication', 'azcli']));
    hset('mcp_servers.azure-devops.tools.exclude', JSON.stringify(ADO_READ_ONLY));
  });
  if (argv.includes('--claude-subscription')) step('primary model: Claude subscription (DirectSDK)', () => {
    const listed = run('hermes', ['plugins', 'list', '--json'], { allowFail: true, readOnly: true }).stdout ?? '';
    if (!listed.includes('claude-subscription-directsdk-experimental')) run('hermes', ['plugins', 'install', 'claude-subscription-directsdk', '--enable']);
    hset('model.provider', 'claude-subscription-directsdk-experimental');
    hset('model.default', cfg.hermesModel ?? 'claude-opus-5-5[1m]');
    hset('model.base_url', '');
  });
  todo.push('Codex in Hermes: hermes auth add openai-codex --type oauth, then: hermes fallback add');
}

console.log('Codex');
const codexToml = join(HOME, '.codex', 'config.toml');
if (!existsSync(codexToml)) console.log('  SKIP no ~/.codex/config.toml');
else step('CLAUDE.md fallback, Claude import sync off', () => {
  let t = readFileSync(codexToml, 'utf8');
  const before = t, eol = t.includes('\r\n') ? '\r\n' : '\n';
  if (!/^project_doc_fallback_filenames\s*=/m.test(t)) t = `project_doc_fallback_filenames = ["CLAUDE.md"]${eol}` + t;
  t = t.replace(/^external-agent-import-sync-enabled\s*=\s*true\s*$/m, 'external-agent-import-sync-enabled = false');
  if (t === before) return 'current';
  if (!DRY) { backup(codexToml); writeFileSync(codexToml, t); }
  return 'updated';
});

console.log('Orca');
const orcaRoot = WIN ? join(process.env.APPDATA ?? '', 'orca') : join(HOME, '.config', 'orca');
const orcaIndex = join(orcaRoot, 'orca-profile-index.json');
if (!existsSync(orcaIndex)) console.log('  SKIP Orca has not run yet');
else if (spawnSync(WIN ? 'tasklist' : 'pgrep', WIN ? ['/fi', 'imagename eq Orca.exe'] : ['-x', 'Orca'], { encoding: 'utf8' }).stdout.match(/orca/i)) {
  console.log('  TODO Orca is running; close it and rerun setup (or set in Orca Settings: default agent Hermes, Hermes args --checkpoints, workspace dir)');
} else step(`default agent Hermes, --checkpoints, worktrees in ${root}/Worktrees`, () => {
  const active = JSON.parse(readFileSync(orcaIndex, 'utf8')).activeProfileId;
  mkdirSync(native(`${root}/Worktrees`), { recursive: true });
  return editJson(join(orcaRoot, 'profiles', active, 'orca-data.json'), (d) => {
    d.settings ??= {};
    if (which('hermes')) d.settings.defaultTuiAgent = 'hermes';
    d.settings.agentDefaultArgs = { ...d.settings.agentDefaultArgs, hermes: '--checkpoints' };
    d.settings.workspaceDir = `${root}/Worktrees`;
  });
});

if (todo.length) { console.log('Next (by hand):'); for (const t of todo) console.log(`  - ${t}`); }
