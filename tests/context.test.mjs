import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARNESS, writeJson } from '../cli/ortak.mjs';
import { clip, nextAction, projectRules, resolveChecks, workLines } from '../cli/context.mjs';
import { firing, skillLines } from '../cli/next.mjs';
import { fillStep } from '../cli/contract.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'narvai-ctx-'));
const routes = [
  { id: 'ui', when: { event: 'edit', paths: ['**/*.tsx', '**/*.css'] }, skills: ['@project-design', 'impeccable'], why: 'UI work' },
  { id: 'react', when: { event: 'edit', paths: ['**/*.tsx'] }, skills: ['impeccable', 'react'], why: 'React' },
  { id: 'bug', when: { event: 'failure' }, skills: ['debugging'], why: 'a failure' },
];

test('a route fires on its event, and on a matching path when it names paths', () => {
  assert.deepEqual(firing(routes, 'failure', []).map((r) => r.id), ['bug']);
  assert.deepEqual(firing(routes, 'edit', ['src/a/B.tsx']).map((r) => r.id), ['ui', 'react']);
  assert.deepEqual(firing(routes, 'edit', ['site.css']).map((r) => r.id), ['ui']);
  assert.deepEqual(firing(routes, 'edit', ['src/a.cs']), []);
  assert.deepEqual(firing(routes, 'edit', []), []);
});

test('each skill prints once, with its path, or as missing', () => {
  const known = { impeccable: '/s/impeccable/SKILL.md', react: '/s/react/SKILL.md' };
  const lines = skillLines(routes, 'edit', ['a.tsx'], (n) => (known[n] ? { name: n, path: known[n] } : { name: n }));
  assert.deepEqual(lines, ['missing: @project-design', 'impeccable  /s/impeccable/SKILL.md  UI work', 'react  /s/react/SKILL.md  React']);
});

test('project-rules.md: the include line is replaced by the shared file, a missing one warns', () => {
  const store = join(temp(), 'p');
  mkdirSync(join(store, '..', 'shared'), { recursive: true });
  assert.deepEqual(projectRules(store).lines, []);
  writeFileSync(join(store, '..', 'shared', 'rules.md'), '# shared\n\n- s1\n');
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, 'project-rules.md'), 'include: ../shared/rules.md\n# own\n- o1\n');
  assert.deepEqual(projectRules(store).lines, ['# shared', '- s1', '# own', '- o1']);
  writeFileSync(join(store, 'project-rules.md'), 'include: ../nope.md\n- o1\n');
  assert.match(projectRules(store).lines[0], /^WARN include not found: .*nope\.md$/);
  writeFileSync(join(store, 'project-rules.md'), '- o1\n\ninclude: later lines are plain text\n');
  assert.deepEqual(projectRules(store).lines, ['- o1', 'include: later lines are plain text']);
});

test('clip keeps the limit and says how much was cut', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);
  assert.equal(clip(ten, 10), ten);
  assert.deepEqual(clip(ten, 4, 'more'), ['l0', 'l1', 'l2', '... 7 more']);
});

test('next_action is read inline or from a block; branch mismatch is a warning', () => {
  assert.equal(nextAction('id: x\nnext_action: "do it"\n'), 'do it');
  assert.equal(nextAction('next_action: |\n  first\n  second\nother: 1\n'), 'first second');
  const items = [
    { id: 'a', dir: '/w/a', status: 'implementing', branch: 'feat/a', next: 'go', open: true },
    { id: 'b', dir: '/w/b', status: 'complete', branch: 'feat/b', next: '', open: false },
  ];
  assert.match(workLines(items, 'feat/a').join('\n'), /^work: a \[implementing\] \/w\/a\/state\.yaml\nnext_action: go$/);
  const off = workLines(items, 'feat/b');
  assert.equal(off[0], 'work: none open on branch feat/b (b is complete)');
  assert.match(off[1], /^WARN .*a@feat\/a/);
  assert.match(workLines([items[0], { ...items[0], id: 'c' }], 'feat/a')[0], /^WARN 2 open work items on branch feat\/a/);
});

test('profile checks take package.json script names, else the fallback, else drop', () => {
  const repo = temp();
  const stack = { checks: [
    { name: 'typecheck', scripts: ['typecheck'], run: 'npx tsc --noEmit' },
    { name: 'lint', scripts: ['lint'] },
    { name: 'tests', scripts: ['test'], scope: 'src/*' },
  ] };
  writeJson(join(repo, 'package.json'), { packageManager: 'pnpm@10.0.0', scripts: { test: 'vitest run' } });
  assert.deepEqual(resolveChecks(repo, [stack], null).checks.map((c) => c.run), ['npx tsc --noEmit', 'pnpm test']);
  writeJson(join(repo, 'package.json'), { scripts: { test: 'vitest run', lint: 'eslint .' } });
  assert.deepEqual(resolveChecks(repo, [stack], null).checks.map((c) => c.run), ['npx tsc --noEmit', 'npm run lint', 'npm run test --']);
  writeJson(join(repo, 'store', 'verify.json'), { checks: [{ name: 'x', run: 'make' }] });
  assert.equal(resolveChecks(repo, [stack], join(repo, 'store')).from, 'verify.json');
  assert.equal(fillStep('a `{check:lint}` b `{script:gen|api:generate}`', repo, [{ name: 'lint', run: 'L' }]), 'a `L` b `no package.json script among gen, api:generate`');
});

test('narvai context stays within 90 lines, 25 with --hook', () => {
  const t = temp();
  const repo = join(t, 'repo'), store = join(t, 'store', 'repo');
  mkdirSync(repo);
  mkdirSync(store, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'App.csproj'), '');
  writeJson(join(t, '.narvai', 'config.json'), { storeRoot: join(t, 'store') });
  writeJson(join(t, 'store', 'map.json'), { [repo]: store });
  writeFileSync(join(store, 'project-rules.md'), Array.from({ length: 100 }, (_, i) => `- rule ${i}`).join('\n'));
  const env = { ...process.env, NARVAI_HOME: t };
  delete env.AI_HARNESS_MEMORY;
  delete env.CODEX_HOME;
  const run = (...a) => execFileSync('node', [join(HARNESS, 'narvai.mjs'), 'context', ...a], { cwd: repo, env, encoding: 'utf8' }).trimEnd().split('\n');
  const full = run();
  assert.equal(full.length, 90);
  assert.match(full.join('\n'), /^stacks: dotnet$/m);
  assert.match(full.at(-1), /^\.\.\. \d+ more lines in .*project-rules\.md$/);
  const hook = run('--hook');
  assert.equal(hook.length, 25);
  assert.match(hook.at(-1), /^\.\.\. \d+ more lines in/);
});
