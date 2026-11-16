import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectStacks, home, storeFor, writeJson } from '../cli/ortak.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'narvai-test-'));

function withHome(dir, fn) {
  const was = process.env.NARVAI_HOME;
  process.env.NARVAI_HOME = dir;
  try { return fn(); } finally { if (was === undefined) delete process.env.NARVAI_HOME; else process.env.NARVAI_HOME = was; }
}

test('home() follows NARVAI_HOME, else the OS home', () => {
  withHome('', () => assert.equal(home(), homedir()));
  withHome('X:/fake', () => assert.equal(home(), 'X:/fake'));
});

test('storeFor() resolves a worktree to its main repository', () => {
  const t = temp();
  const repo = join(t, 'repo'), wt = join(t, 'wt'), store = join(t, 'store');
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  mkdirSync(repo);
  g('init', '-q');
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  g('worktree', 'add', '-q', wt);
  writeJson(join(t, '.narvai', 'config.json'), { storeRoot: store });
  writeJson(join(store, 'map.json'), { [repo]: join(store, 'repo') });
  const was = process.env.AI_HARNESS_MEMORY;
  delete process.env.AI_HARNESS_MEMORY;
  try {
    withHome(t, () => {
      assert.equal(storeFor(repo), join(store, 'repo'));
      assert.equal(storeFor(wt), join(store, 'repo'));
      assert.equal(storeFor(t), null);
    });
  } finally { if (was !== undefined) process.env.AI_HARNESS_MEMORY = was; }
});

test('storeFor() without storeRoot is a one-line error naming setup', () => {
  const was = process.env.AI_HARNESS_MEMORY;
  delete process.env.AI_HARNESS_MEMORY;
  try { withHome(temp(), () => assert.throws(() => storeFor('.'), /^Error: storeRoot is not set in .*: run narvai setup$/)); }
  finally { if (was !== undefined) process.env.AI_HARNESS_MEMORY = was; }
});

test('detectStacks() evaluates every profile detect glob', () => {
  const t = temp();
  const profiles = join(t, 'profiles'), repo = join(t, 'repo');
  writeJson(join(profiles, 'dotnet', 'profile.json'), { name: 'dotnet', detect: ['*.sln', '**/*.csproj'] });
  writeJson(join(profiles, 'nextjs', 'profile.json'), { name: 'nextjs', detect: ['**/next.config.*'] });
  mkdirSync(join(repo, 'src', 'Api'), { recursive: true });
  mkdirSync(join(repo, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(repo, 'src', 'Api', 'Api.csproj'), '');
  writeFileSync(join(repo, 'node_modules', 'x', 'next.config.js'), '');
  assert.deepEqual(detectStacks(repo, profiles), ['dotnet']);
  writeFileSync(join(repo, 'next.config.mjs'), '');
  assert.deepEqual(detectStacks(repo, profiles), ['dotnet', 'nextjs']);
  assert.deepEqual(detectStacks(repo, join(t, 'none')), []);
});

test('sync writes a narvai command that runs', async () => {
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const t = mkdtempSync(join(tmpdir(), 'narvai-shim-'));
  try {
    const env = { ...process.env, NARVAI_HOME: t };
    execFileSync(process.execPath, ['-e', "import('./cli/sync.mjs').then((m) => m.shim())", '--input-type=module'], { cwd: join(import.meta.dirname, '..'), env });
    const cmd = join(t, '.narvai', 'bin', process.platform === 'win32' ? 'narvai.cmd' : 'narvai');
    assert.ok(existsSync(cmd));
    const out = execFileSync(cmd, [], { encoding: 'utf8', shell: process.platform === 'win32' });
    assert.match(out, /narvai context/);
  } finally { rmSync(t, { recursive: true, force: true }); }
});
