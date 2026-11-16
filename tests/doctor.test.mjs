import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexEnabledPlugins, findRefs, groupRefs, hookEvents, LIMITS, missingHookFiles, resolveRef, sizeFindings, versionAtLeast } from '../cli/doctor.mjs';
import { frontmatter, indexOf } from '../cli/usage.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'narvai-doctor-test-'));
const e = (id, extra = {}) => ({ id, name: id.split(':').at(-1), plugin: id.includes(':') ? id.split(':')[0] : null, enabled: true, source: id.includes(':') ? 'plugin' : 'hub', chars: 100, descChars: 100, ...extra });
const idx = indexOf([
  e('unslop'), e('caveman'), e('ponytail-review'),
  e('pstack:unslop'), e('pstack:architect'), e('ponytail:ponytail-review'), e('agent-skills:spec-driven-development'),
  e('agent-skills:spec', { command: true }),
  e('superpowers:brainstorming', { enabled: false }),
]);

test('resolveRef: exact, wrong prefix, bare under a prefix, disabled plugin, missing', () => {
  assert.equal(resolveRef('unslop', idx).status, 'ok');
  assert.equal(resolveRef('pstack:unslop', idx).status, 'ok');
  const wrong = resolveRef('pstack:ponytail-review', idx);
  assert.equal(wrong.status, 'wrong-prefix');
  assert.match(wrong.hint, /ponytail:ponytail-review/);
  const bare = resolveRef('architect', idx);
  assert.deepEqual([bare.status, bare.hint], ['prefix', 'pstack:architect']);
  assert.equal(resolveRef('superpowers:brainstorming', idx).status, 'off');
  assert.equal(resolveRef('brainstorming', idx).status, 'off');
  assert.equal(resolveRef('anthropic-skills:docx', idx).status, 'missing');
  assert.equal(resolveRef('spec', idx).status, 'missing');
});

test('findRefs: only names that are, or are described as, skills', () => {
  const text = [
    'Use `unslop` and `pstack:architect` here.',
    'The skill `ajan-harness` is gone.',
    'Run `max-w` or `name-only` in the CSS.',
    'Reference file `house-rules-code` is read on demand, see the skill list.',
    'See `file:line` for the spot.',
    'The `agent-skills` plugin and its `agent-skills:code-reviewer` skill.',
    'Call `anthropic-skills:docx` skill.',
    'Bare `architect` and `spec`.',
    '`update-config` for a hook.',
  ].join('\n');
  const found = findRefs(text, idx, { ignore: new Set(['house-rules-code']), plugins: new Set(['agent-skills']), used: new Set(['update-config']) });
  const by = Object.fromEntries(found.map((f) => [f.token, f]));
  assert.deepEqual(Object.keys(by).sort(), ['agent-skills:code-reviewer', 'ajan-harness', 'anthropic-skills:docx', 'architect', 'update-config']);
  assert.equal(by['ajan-harness'].line, 2);
  assert.equal(by['architect'].status, 'prefix');
  assert.equal(by['update-config'].seen, true);
  assert.equal(by['ajan-harness'].seen, false);
});

test('groupRefs: one row per name, FAIL only for a missing name in a structured source', () => {
  const f = (token, status, where, strict = false) => ({ token, status, hint: 'x:y', seen: false, where, strict });
  const rows = groupRefs([f('a-b', 'missing', 'routes.json route ui', true), f('a-b', 'missing', 'SKILL.md:3'), f('c-d', 'missing', 'SKILL.md:9'), f('e-f', 'prefix', 'routes.json listed', true)]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].level, 'FAIL');
  assert.match(rows[0].text, /a-b: not installed anywhere \(routes\.json route ui \+1\)/);
  assert.equal(rows[1].level, 'WARN');
  assert.equal(rows[2].level, 'WARN');
});

test('sizeFindings: Claude cap, spec limit, Codex total', () => {
  const small = [e('a', { chars: 300, descChars: 300 }), e('b', { chars: 700, descChars: 700 })];
  const s = sizeFindings(small);
  assert.deepEqual([s.count, s.total, s.longest.id, s.overClaude.length, s.overSpec.length, s.overCodex], [2, 1000, 'b', 0, 0, false]);

  const big = sizeFindings([e('long', { chars: LIMITS.claudeEntry + 1, descChars: LIMITS.specDescription + 1 }), e('edge', { chars: LIMITS.claudeEntry, descChars: LIMITS.specDescription })]);
  assert.deepEqual([big.overClaude.map((x) => x.id), big.overSpec.map((x) => x.id)], [['long'], ['long']]);

  const many = sizeFindings(Array.from({ length: 9 }, (_, i) => e(`s${i}`, { chars: 900 })));
  assert.equal(many.overCodex, true);
  assert.equal(sizeFindings(Array.from({ length: 8 }, (_, i) => e(`s${i}`, { chars: 1000 }))).overCodex, false);
  assert.deepEqual(sizeFindings([]), { count: 0, total: 0, longest: null, overClaude: [], overSpec: [], overCodex: false });
});

test('versionAtLeast compares three numbers', () => {
  assert.equal(versionAtLeast('2.1.325 (Claude Code)', [2, 1, 277]), true);
  assert.equal(versionAtLeast('2.1.277', [2, 1, 277]), true);
  assert.equal(versionAtLeast('2.1.276', [2, 1, 277]), false);
  assert.equal(versionAtLeast('3.0.0', [2, 9, 9]), true);
  assert.equal(versionAtLeast('none', [2, 1, 277]), null);
});

test('missingHookFiles reports absolute script paths that do not exist', () => {
  const dir = temp();
  const real = join(dir, 'guard.mjs');
  writeFileSync(real, '');
  const gone = join(dir, 'gone.mjs').replaceAll('\\', '/');
  assert.deepEqual(missingHookFiles([`node "${real.replaceAll('\\', '/')}" claude`, `node "${gone}" claude`, 'echo hi', '${CLAUDE_PLUGIN_ROOT}/hooks/x.sh']), [gone]);
});

test('hookEvents reads hooks/hooks.json, a manifest path and an inline manifest', () => {
  const dir = temp();
  mkdirSync(join(dir, 'a', 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'a', 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
  mkdirSync(join(dir, 'b', '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, 'b', 'h.json'), JSON.stringify({ hooks: { SubagentStart: [], UserPromptSubmit: [] } }));
  writeFileSync(join(dir, 'b', '.claude-plugin', 'plugin.json'), JSON.stringify({ hooks: './h.json' }));
  mkdirSync(join(dir, 'c'), { recursive: true });
  writeFileSync(join(dir, 'c', 'plugin.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
  mkdirSync(join(dir, 'd'));
  assert.deepEqual([...hookEvents(join(dir, 'a'))], ['SessionStart']);
  assert.deepEqual([...hookEvents(join(dir, 'b'))].sort(), ['SubagentStart', 'UserPromptSubmit']);
  assert.deepEqual([...hookEvents(join(dir, 'c'))], ['SessionStart']);
  assert.equal(hookEvents(join(dir, 'd')).size, 0);
});

test('codexEnabledPlugins reads enabled plugin tables only', () => {
  const toml = '[plugins."a@m"]\nenabled = true\n\n[plugins."b@m"]\nenabled = false\n\n[features]\nenabled = true\n\n[plugins."c@m"]\nsource = "x"\nenabled = true\n';
  assert.deepEqual([...codexEnabledPlugins(toml)], ['a@m', 'c@m']);
});

test('frontmatter: plain, quoted, folded and continued values', () => {
  const fm = frontmatter('---\nname: x\ndescription: >\n  First line\n  second line.\nwhen_to_use: "Use for \\"a\\" thing"\nhidden: plain value\n  that continues\ndisable-model-invocation: true\n---\nbody: not parsed');
  assert.deepEqual(fm, { name: 'x', description: 'First line second line.', when_to_use: 'Use for "a" thing', hidden: 'plain value that continues', 'disable-model-invocation': 'true' });
  assert.deepEqual(frontmatter('no front matter'), {});
});

test('doctor --fix regenerates drifted rule files, in a temporary home only', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const home = temp();
  mkdirSync(join(home, '.narvai'), { recursive: true });
  writeFileSync(join(home, '.narvai', 'config.json'), JSON.stringify({ storeRoot: join(home, 'store'), aiRoot: join(home, 'ai'), language: 'en', memoryProject: 'test' }));
  for (const d of ['.claude', '.codex']) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), '<!-- GENERATED by narvai.mjs sync from rules/GLOBAL.md -->\nold\n');
  const doctor = (...args) => spawnSync(process.execPath, [join(root, 'narvai.mjs'), 'doctor', ...args], { env: { ...process.env, NARVAI_HOME: home }, encoding: 'utf8' });
  const before = doctor();
  assert.match(before.stdout, /WARN .*CLAUDE\.md differs from its sources/);
  const fixed = doctor('--fix');
  assert.match(fixed.stdout, /running sync/);
  assert.match(fixed.stdout, /OK {3}generated files match their sources/);
  assert.ok(existsSync(join(home, '.codex', 'AGENTS.md')));
  assert.doesNotMatch(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), /^old$/m);
});

test('usage merges transcripts and the Claude counter, and lists removed names', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const home = temp();
  mkdirSync(join(home, '.claude', 'projects', 'p'), { recursive: true });
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ skillUsage: { 'narvai-orchestrator': { usageCount: 41, lastUsedAt: Date.parse('2026-11-10') }, 'old-name': { usageCount: 3, lastUsedAt: Date.parse('2026-09-01') } } }));
  const hit = (skill) => JSON.stringify({ timestamp: '2026-11-12T10:00:00Z', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } });
  writeFileSync(join(home, '.claude', 'projects', 'p', 's.jsonl'), [hit('narvai-orchestrator'), hit('narvai-orchestrator'), hit('old-name'), hit('gone-too')].join('\n'));
  const out = spawnSync(process.execPath, [join(root, 'narvai.mjs'), 'usage'], { env: { ...process.env, NARVAI_HOME: home }, encoding: 'utf8' }).stdout;
  assert.match(out, /^\s+2\s+41\s+2026-11-12\s+\d+\s+narvai-orchestrator/m);
  assert.match(out, /used but not installed: 2/);
  assert.match(out, /^\s+1\s+3\s+2026-11-12\s+-\s+old-name/m);
  assert.match(out, /^\s+1\s+-\s+2026-11-12\s+-\s+gone-too/m);
});
