import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { frontmatter, isHubLink, jsonPluginsOff, linkInto, listedSet, registry, scan, tomlPluginsOff } from '../cli/skills-link.mjs';

const skill = (dir, name, description = `${name} does a thing`) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`);
};

function fixture() {
  const h = mkdtempSync(join(tmpdir(), 'narvai-reg-'));
  skill(join(h, 'skills'), 'review');
  skill(join(h, 'third-party', 'skills'), 'review');
  skill(join(h, 'third-party', 'skills'), 'unslop');
  writeFileSync(join(h, 'third-party.json'), JSON.stringify({ sources: [{ set: 'pstack', repo: 'x/pstack', commit: 'abc', license: 'MIT', skills: ['review', 'unslop'] }] }));
  return h;
}

test('frontmatter reads plain, quoted and folded descriptions', () => {
  assert.equal(frontmatter('---\nname: a\ndescription: "Say \\"hi\\""\n---\n').description, 'Say "hi"');
  assert.equal(frontmatter('---\ndescription: >-\n  one\n  two\nlicense: MIT\n---\n').description, 'one two');
  assert.equal(frontmatter("---\ndescription: 'it''s'\n---\n").description, "it's");
  assert.deepEqual(frontmatter('no front matter'), {});
});

test('a name collision gives every copy a <set>/<name> id and the bare name to one owner', () => {
  const h = fixture();
  try {
    const found = scan(h);
    assert.deepEqual(found.map((s) => s.id), ['narvai/review', 'pstack/review', 'pstack/unslop']);
    const byDefault = registry(found);
    assert.deepEqual(byDefault.filter((s) => s.bare).map((s) => s.id), ['narvai/review', 'pstack/unslop']);
    const routed = registry(found, { routes: [{ skills: ['pstack/review'] }] });
    assert.deepEqual(routed.filter((s) => s.name === 'review').map((s) => [s.id, s.bare]), [['narvai/review', false], ['pstack/review', true]]);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('regeneration keeps fit and reason by id', () => {
  const h = fixture();
  try {
    const prev = [{ id: 'pstack/unslop', fit: 'core', reason: 'prose' }];
    const reg = registry(scan(h), {}, prev);
    assert.deepEqual(reg.map((s) => s.fit), ['unreviewed', 'unreviewed', 'core']);
    assert.equal(reg.at(-1).reason, 'prose');
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('listed set is routes.listed plus profile skills, resolved by bare name or id, @names skipped', () => {
  const h = fixture();
  try {
    const reg = registry(scan(h));
    const r = listedSet(reg, { listed: ['unslop', 'missing-one'] }, [{ skills: ['pstack/review', '@project-design', 'unslop'] }]);
    assert.deepEqual(r.skills.map((s) => s.id), ['pstack/unslop', 'pstack/review']);
    assert.deepEqual(r.missing, ['missing-one']);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('linkInto links the listed set, unlinks only hub links, leaves folders and foreign links, and is idempotent', () => {
  const t = mkdtempSync(join(tmpdir(), 'narvai-link-'));
  try {
    const hub = join(t, 'hub');
    for (const n of ['a', 'b', 'c']) skill(hub, n);
    const other = join(t, 'other', 'x');
    mkdirSync(other, { recursive: true });
    const dir = join(t, 'skills');
    mkdirSync(dir);
    symlinkSync(join(hub, 'b'), join(dir, 'b'), 'junction');
    symlinkSync(join(hub, 'c'), join(dir, 'old-name'), 'junction');
    symlinkSync(other, join(dir, 'foreign'), 'junction');
    symlinkSync(other, join(dir, 'c'), 'junction');
    mkdirSync(join(dir, 'mine'));
    const want = new Map(['a', 'c'].map((n) => [n, join(hub, n)]));

    const r = linkInto(dir, want, [hub]);
    assert.deepEqual(r, { linked: ['a'], removed: ['b', 'old-name'], skipped: ['c'] });
    assert.deepEqual(readdirSync(dir).sort(), ['a', 'c', 'foreign', 'mine']);
    assert.ok(isHubLink(join(dir, 'a'), [hub]));
    assert.ok(!isHubLink(join(dir, 'foreign'), [hub]) && !isHubLink(join(dir, 'mine'), [hub]));
    assert.ok(lstatSync(join(dir, 'mine')).isDirectory() && existsSync(other));
    assert.deepEqual(linkInto(dir, want, [hub]), { linked: [], removed: [], skipped: ['c'] });
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('a dangling hub link is still recognised and removed', () => {
  const t = mkdtempSync(join(tmpdir(), 'narvai-link-'));
  try {
    const hub = join(t, 'hub');
    skill(hub, 'gone');
    const dir = join(t, 'skills');
    mkdirSync(dir);
    symlinkSync(join(hub, 'gone'), join(dir, 'gone'), 'junction');
    rmSync(join(hub, 'gone'), { recursive: true });
    assert.deepEqual(linkInto(dir, new Map(), [hub]).removed, ['gone']);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('Claude settings: only the named plugins flip to false, the rest of the text is unchanged', () => {
  const text = '{\n  "model": "opus",\n  "enabledPlugins": {\n    "pstack@pstack-claude": true,\n    "csharp-lsp@claude-plugins-official": true,\n    "ponytail@ponytail": false\n  }\n}\n';
  const r = jsonPluginsOff(text, ['pstack', 'ponytail']);
  assert.deepEqual(r.off, ['pstack@pstack-claude']);
  assert.equal(r.text, text.replace('"pstack@pstack-claude": true', '"pstack@pstack-claude": false'));
  assert.equal(jsonPluginsOff(r.text, ['pstack']).text, r.text);
});

test('Codex config.toml: enabled flips to false, a missing enabled line is added, CRLF and other tables are kept', () => {
  const text = ['model = "x"', '', '[plugins."pstack@pstack-claude"]', 'enabled = true', '', '[plugins."ponytail@ponytail"]', '', '[plugins."csharp-lsp@claude-plugins-official"]', 'enabled = true', '[features]', 'enabled = true'].join('\r\n');
  const r = tomlPluginsOff(text, ['pstack', 'ponytail']);
  assert.deepEqual(r.off, ['pstack@pstack-claude', 'ponytail@ponytail']);
  assert.equal(r.text, ['model = "x"', '', '[plugins."pstack@pstack-claude"]', 'enabled = false', '', '[plugins."ponytail@ponytail"]', 'enabled = false', '', '[plugins."csharp-lsp@claude-plugins-official"]', 'enabled = true', '[features]', 'enabled = true'].join('\r\n'));
  assert.deepEqual(tomlPluginsOff(r.text, ['pstack', 'ponytail']), { text: r.text, off: [], failed: [] });
});
