import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { denied, normalise, routeHits, rules } from '../hooks/guard.mjs';
import { registerHooks } from '../hooks/register.mjs';
import { HARNESS, home, readJson } from '../cli/ortak.mjs';

const generic = readJson(join(HARNESS, 'hooks', 'deny.json')).rules;
const shell = (command) => ({ tool: 'Bash', command, paths: [], cwd: '.' });
const idFor = (list, command) => denied(shell(command), list)?.id;

test('generic rules block recursive search from a filesystem root only', () => {
  const blocked = {
    'find / -name x': 'root-find', 'find C:/ -name "*.cs"': 'root-find', 'cd x && find /c/ -name y': 'root-find',
    'Get-ChildItem C:\\ -Recurse -Filter *.cs': 'root-list', 'gci -Recurse -Path D:/': 'root-list',
    'rg TODO /': 'root-grep', 'grep -rn foo /': 'root-grep', 'grep -R foo C:/': 'root-grep',
  };
  for (const [c, id] of Object.entries(blocked)) assert.equal(idFor(generic, c), id, c);
  for (const c of ['find . -name x', 'find /c/Projects/AI -name x', 'find src -type f', 'Get-ChildItem -Recurse -Path C:\\Projects',
    'Get-ChildItem C:\\', 'rg foo C:/Projects', 'grep -rn foo src', 'grep foo /etc/hosts', 'ls -la /', 'git log --find-renames']) {
    assert.equal(idFor(generic, c), undefined, c);
  }
});

const user = join(home(), '.narvai', 'guard.json');
test('user rules: app start, watch, compose and Azure DevOps writes', { skip: !existsSync(user) && 'no ~/.narvai/guard.json' }, () => {
  const list = readJson(user).rules;
  const blocked = {
    'dotnet run --project src/Api': 'app-run', 'dotnet watch': 'app-run', 'npm run dev': 'app-run', 'pnpm dev': 'app-run',
    'yarn start': 'app-run', 'npx next dev': 'app-run', 'docker compose -f x.yml up -d': 'compose-up', 'docker-compose up': 'compose-up',
    'tsc --watch': 'watch-build', 'az pipelines run --name ci': 'ado-cli-write', 'az boards work-item update --id 1': 'ado-cli-write',
    'az repos pr update --id 3 --auto-complete true': 'ado-cli-write',
  };
  for (const [c, id] of Object.entries(blocked)) assert.equal(idFor(list, c), id, c);
  for (const c of ['dotnet build -nodeReuse:false', 'dotnet test', 'npm run build', 'npm test', 'git push origin feat/x', 'docker compose ps',
    'az repos pr create --title t --source-branch a', 'az pipelines runs list', 'az boards work-item show --id 1', 'vitest run --watch=false']) {
    assert.equal(idFor(list, c), undefined, c);
  }
  const mcp = (tool, input) => denied({ tool, command: JSON.stringify(input), paths: [], cwd: '.' }, list)?.id;
  assert.equal(mcp('mcp__azure-devops__pipelines_write', { action: 'run_pipeline' }), 'ado-mcp-write');
  assert.equal(mcp('mcp__azure-devops__wiki_upsert_page', {}), 'ado-mcp-write');
  assert.equal(mcp('mcp__azure-devops__repo_pull_request_write', { action: 'vote' }), 'ado-mcp-pr');
  assert.equal(mcp('mcp__azure-devops__repo_pull_request_write', { action: 'create' }), undefined);
  assert.equal(mcp('mcp__azure-devops__pipelines_run', { action: 'list' }), undefined);
  assert.equal(mcp('mcp__azure-devops__wit_work_item', { action: 'get' }), undefined);
});

test('a live exception lifts a rule until it expires', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const n = shell('find / -name x');
  assert.equal(denied(n, generic, { 'root-find': '2026-11-16T12:30:00Z' }, now), undefined);
  assert.equal(denied(n, generic, { 'root-find': '2026-11-16T11:59:00Z' }, now)?.id, 'root-find');
});

test('deny rules ignore edit tools; rules() reads the shipped file', () => {
  assert.equal(denied({ tool: 'apply_patch', command: '*** Update File: find / x', paths: [], cwd: '.' }, generic), undefined);
  assert.ok(rules().some((r) => r.id === 'root-find'));
});

test('payloads of both harnesses normalise to one shape', () => {
  const claude = normalise({ session_id: 's1', hook_event_name: 'PreToolUse', cwd: 'C:/r', tool_name: 'Edit', tool_input: { file_path: 'C:/r/src/A.tsx', old_string: 'a' } }, 'claude');
  assert.deepEqual(claude, { harness: 'claude', event: 'PreToolUse', tool: 'Edit', command: '', paths: ['C:/r/src/A.tsx'], cwd: 'C:/r', session: 's1' });
  const patch = '*** Begin Patch\n*** Update File: src/a.tsx\n@@\n-x\n+y\n*** Add File: b.css\n+z\n*** End Patch';
  const codex = normalise({ session_id: 's2', turn_id: 't', hook_event_name: 'PreToolUse', cwd: '/r', tool_name: 'apply_patch', tool_input: { command: patch } }, 'codex');
  assert.deepEqual(codex.paths, ['src/a.tsx', 'b.css']);
  assert.equal(normalise({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, 'codex').command, 'ls');
  assert.equal(normalise({ tool_name: 'mcp__x__y', tool_input: { a: 1 } }, 'claude').command, '{"a":1}');
  assert.equal(normalise({ hook_event_name: 'SessionStart', source: 'startup', cwd: '/r', session_id: 's' }, 'claude').tool, '');
});

test('edit routes fire once per route per session', () => {
  const routes = [{ id: 'ui', when: { event: 'edit', paths: ['**/*.tsx'] } }, { id: 'ef', when: { event: 'edit', paths: ['**/Queries/**/*.cs'] } }, { id: 'bug', when: { event: 'failure' } }];
  const n = { tool: 'Edit', paths: ['C:/r/src/A.tsx'], cwd: 'C:/r' };
  assert.deepEqual(routeHits(n, routes).map((r) => r.id), ['ui']);
  assert.deepEqual(routeHits(n, routes, ['ui']), []);
  assert.deepEqual(routeHits({ tool: 'apply_patch', paths: ['src/Queries/Get.cs'], cwd: '/r' }, routes).map((r) => r.id), ['ef']);
  assert.deepEqual(routeHits({ tool: 'Bash', paths: ['a.tsx'], cwd: '/r' }, routes), []);
});

test('registration replaces old narvai entries, keeps others, is idempotent', () => {
  const home = mkdtempSync(join(tmpdir(), 'narvai-reg-'));
  const was = process.env.NARVAI_HOME;
  process.env.NARVAI_HOME = home;
  const orca = (cmd) => ({ hooks: [{ type: 'command', command: cmd, timeout: 10 }] });
  mkdirSync(join(home, '.claude'));
  mkdirSync(join(home, '.codex'));
  const claudeFile = join(home, '.claude', 'settings.json'), codexFile = join(home, '.codex', 'hooks.json');
  writeFileSync(claudeFile, JSON.stringify({ model: 'x', hooks: {
    SessionStart: [{ matcher: 'compact', ...orca('node "H/hooks/store-context.mjs" compact || echo {}') }, orca('orca.exe claude')],
    UserPromptSubmit: [orca('node "H/hooks/narvai-guard.mjs" || true')],
    PreToolUse: [{ matcher: '*', ...orca('orca.exe claude') }],
  } }));
  writeFileSync(codexFile, JSON.stringify({ hooks: { PreToolUse: [orca('codex-hook.cmd')] } }));
  const log = console.log;
  console.log = () => {};
  try {
    registerHooks({ home });
    const first = [readFileSync(claudeFile, 'utf8'), readFileSync(codexFile, 'utf8')];
    registerHooks({ home });
    assert.deepEqual([readFileSync(claudeFile, 'utf8'), readFileSync(codexFile, 'utf8')], first);
  } finally {
    console.log = log;
    if (was === undefined) delete process.env.NARVAI_HOME; else process.env.NARVAI_HOME = was;
  }
  const c = readJson(claudeFile);
  assert.equal(c.model, 'x');
  assert.equal(c.hooks.UserPromptSubmit, undefined);
  assert.deepEqual(c.hooks.SessionStart.map((e) => e.hooks[0].command.split(' ')[0]), ['orca.exe', 'node']);
  assert.deepEqual(c.hooks.PreToolUse.map((e) => e.hooks[0].command.split(' ')[0]), ['orca.exe', 'node']);
  assert.match(c.hooks.PreToolUse[1].hooks[0].command, /hooks\/guard\.mjs" claude$/);
  const x = readJson(codexFile);
  assert.equal(x.hooks.PreToolUse[0].hooks[0].command, 'codex-hook.cmd');
  assert.match(x.hooks.PreToolUse[1].hooks[0].command, /hooks\/guard\.mjs" codex$/);
  assert.equal(readdirSync(join(home, '.narvai', 'backups')).length, 2);
});
