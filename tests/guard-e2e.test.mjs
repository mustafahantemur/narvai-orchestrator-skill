import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { denied } from '../hooks/guard.mjs';
import { withBlock } from '../cli/hooks.mjs';
import { HARNESS, readJson } from '../cli/ortak.mjs';

const GUARD = join(HARNESS, 'hooks', 'guard.mjs');
const generic = readJson(join(HARNESS, 'hooks', 'deny.json')).rules;
const idFor = (command, tool = 'Bash') => denied({ tool, command, paths: [], cwd: '.' }, generic)?.id;

function home(files = {}) {
  const t = mkdtempSync(join(tmpdir(), 'narvai-guard-'));
  mkdirSync(join(t, '.narvai'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(t, '.narvai', name), text);
  return t;
}

// The hook as the agent's harness calls it: JSON on stdin, a decision on stdout.
function hook(payload, NARVAI_HOME) {
  const r = spawnSync(process.execPath, [GUARD, 'claude'], { input: typeof payload === 'string' ? payload : JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '.', session_id: `t${Math.random()}`, ...payload }), encoding: 'utf8', env: { ...process.env, NARVAI_HOME } });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('end to end: a root search is refused, an ordinary command passes, malformed input is not a crash', () => {
  const h = home();
  const no = hook(bash('find / -name x'), h);
  assert.equal(no.permissionDecision, 'deny');
  assert.match(no.permissionDecisionReason, /their own terminal: narvai allow root-find/);
  assert.equal(hook(bash('find src -name x'), h), null);
  assert.equal(hook('{not json', h), null);
});

test('an agent cannot lift a rule: allow is refused, the guard files are closed, a broken exception file changes nothing', () => {
  const h = home();
  for (const c of ['narvai allow root-find', 'node "C:/x/narvai.mjs" allow app-run --minutes 600', 'cd x && narvai.cmd allow root-find', 'echo {} > ~/.narvai/allow.json', 'cat ~/.narvai/guard.json']) {
    const r = hook(bash(c), h);
    assert.equal(r?.permissionDecision, 'deny', c);
    assert.ok(!r.permissionDecisionReason.includes('narvai allow narvai-allow'), 'a fixed rule offers no exception');
  }
  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: join(h, '.narvai', 'allow.json'), content: '{}' } }, h)?.permissionDecision, 'deny');
  assert.equal(hook(bash('git commit -m "docs: narvai allow needs a terminal"'), h), null);
  const fixedLifted = home({ 'allow.json': JSON.stringify({ 'narvai-allow': '2999-01-01T00:00:00Z', 'root-find': '2999-01-01T00:00:00Z' }) });
  assert.equal(hook(bash('narvai allow root-find'), fixedLifted)?.permissionDecision, 'deny');
  assert.equal(hook(bash('find / -name x'), fixedLifted), null);
  assert.equal(hook(bash('find / -name x'), home({ 'allow.json': '{not json' }))?.permissionDecision, 'deny');
});

test('one broken user rule does not switch the others off; a tool rule fires for an edit tool; a shell rule ignores MCP input', () => {
  const rules = { rules: [{ id: 'bad', command: '(unclosed', reason: 'r', instead: 'i' }, { id: 'good', command: 'zzdanger', reason: 'r', instead: 'i' }, { id: 'no-env', tool: '^Write$', path: '\\.env$', reason: 'r', instead: 'i' }] };
  const h = home({ 'guard.json': JSON.stringify(rules) });
  assert.match(hook(bash('zzdanger now'), h).permissionDecisionReason, /narvai allow good/);
  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: 'C:\\r\\app\\.env', content: 'x' } }, h)?.permissionDecision, 'deny');
  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: 'C:\\r\\app\\a.ts', content: 'x' } }, h), null);
  assert.equal(hook({ tool_name: 'mcp__memory__search', tool_input: { query: 'why find / is blocked, zzdanger' } }, h), null);
});

test('root search: the forms an agent reaches for are refused', () => {
  const blocked = {
    'find . / -name foo': 'root-find', 'find /* -name foo': 'root-find', 'find /. -name foo': 'root-find', 'find // -name foo': 'root-find',
    'find -D stat / -name foo': 'root-find', 'find.exe / -name foo': 'root-find', 'time find /c -name foo': 'root-find', 'find /c -name "x"': 'root-find',
    'ls -lR /': 'root-ls', 'ls -R /c/': 'root-ls', 'Get-ChildItem -Path C:\\ -Depth 50 -Filter foo': 'root-list',
    'cd / && find . -name foo': 'root-cd', 'cd /c && grep -r foo .': 'root-cd', 'Set-Location C:\\; Get-ChildItem -Recurse -Filter foo': 'root-cd',
    'grep -d recurse foo /': 'root-grep',
  };
  for (const [c, id] of Object.entries(blocked)) assert.equal(idFor(c, c.startsWith('Get-') || c.startsWith('Set-') ? 'PowerShell' : 'Bash'), id, c);
});

test('root search: text that only mentions a search, and harmless look-alikes, pass', () => {
  for (const c of ['find /i "error" build.log', 'find /c "FAIL" test.log', 'git commit -m "fix find / bug in paths"', "echo 'use find / carefully'",
    'gh pr create --body "guard blocks rg x / now"', 'ls -r /', 'ls -la /', 'cd /c/Projects/AI && find . -name x', 'cd / && pwd', 'grep foo /etc/hosts']) {
    assert.equal(idFor(c), undefined, c);
  }
});

test('git hook block: goes in front of a closing exit, so it runs', () => {
  const user = '#!/bin/sh\nrun_checks\nexit 0\n';
  const out = withBlock(user, 'pre-push', 'echo narvai');
  assert.equal(out, '#!/bin/sh\nrun_checks\n# >>> narvai pre-push\necho narvai\n# <<< narvai pre-push\nexit 0\n');
  assert.equal(withBlock(out, 'pre-push', 'echo narvai'), out);
});
