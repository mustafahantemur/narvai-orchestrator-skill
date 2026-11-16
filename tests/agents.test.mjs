import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codexFile, claudeFile, emitAgents, modelFor, parseAgent } from '../cli/agents-emit.mjs';

process.env.NARVAI_HOME = mkdtempSync(join(tmpdir(), 'narvai-agents-cfg-'));
const tmp = () => mkdtempSync(join(tmpdir(), 'narvai-agents-'));
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test('role to model and effort, per harness', () => {
  assert.deepEqual(modelFor('explore', 'claude', {}), { model: 'haiku', effort: 'low' });
  assert.deepEqual(modelFor('implement', 'claude', {}), { model: 'sonnet', effort: 'medium' });
  assert.deepEqual(modelFor('review', 'claude', {}), { model: 'opus', effort: 'high' });
  assert.deepEqual(modelFor('review', 'codex', {}), { effort: 'high' });
});

test('cfg models override one field, per harness and role', () => {
  const models = { claude: { review: { model: 'sonnet' } }, codex: { explore: { model: 'x-mini', effort: 'medium' } } };
  assert.deepEqual(modelFor('review', 'claude', models), { model: 'sonnet', effort: 'high' });
  assert.deepEqual(modelFor('explore', 'codex', models), { model: 'x-mini', effort: 'medium' });
  assert.deepEqual(modelFor('explore', 'claude', models), { model: 'haiku', effort: 'low' });
});

test('unknown role is a one-line error', () => {
  assert.throws(() => modelFor('plan', 'claude', {}), /unknown agent role "plan"/);
});

test('omitRules becomes omitClaudeMd, tools pass through, codex has neither', () => {
  const a = parseAgent('---\nname: k\ndescription: d "q"\nrole: explore\ntools: Read, Grep\nomitRules: true\n---\nbody\n');
  const c = claudeFile(a, modelFor('explore', 'claude', {}));
  assert.match(c, /^---\nname: narvai-k\n/);
  assert.match(c, /\ntools: Read, Grep\n/);
  assert.match(c, /\nomitClaudeMd: true\n/);
  assert.match(c, /\ndescription: "d \\"q\\""\n/);
  const x = codexFile(a, modelFor('explore', 'codex', {}));
  assert.match(x, /\nname = "narvai-k"\n/);
  assert.match(x, /\nmodel_reasoning_effort = "low"\n/);
  assert.doesNotMatch(x, /^model = /m);
  assert.doesNotMatch(x, /tools|omit/);
  assert.match(x, /developer_instructions = '''\nbody\n'''/);
  assert.doesNotMatch(claudeFile(parseAgent('---\nname: u\ndescription: d\nrole: implement\nomitRules: false\n---\nb'), { model: 'sonnet' }), /omitClaudeMd|tools/);
});

test('emit writes both harnesses, and never touches a file it did not create', async () => {
  const home = tmp();
  const mine = join(home, '.claude', 'agents', 'narvai-kesif.md');
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  writeFileSync(mine, 'user wrote this');
  const written = await quiet(() => emitAgents({ home }));
  assert.equal(readFileSync(mine, 'utf8'), 'user wrote this');
  assert.equal(written.length, 5);
  assert.deepEqual(readdirSync(join(home, '.codex', 'agents')).sort(), ['narvai-gozden-gecir.toml', 'narvai-kesif.toml', 'narvai-uygula.toml']);
  assert.equal(readdirSync(join(home, '.claude', 'agents')).length, 3);
});

test('emit rewrites its own files and leaves user agents alone', async () => {
  const home = tmp();
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(home, '.claude', 'agents', 'pbr-mechanic.md'), 'mine');
  await quiet(() => emitAgents({ home }));
  const f = join(home, '.claude', 'agents', 'narvai-uygula.md');
  writeFileSync(f, readFileSync(f, 'utf8') + 'drift');
  await quiet(() => emitAgents({ home }));
  assert.doesNotMatch(readFileSync(f, 'utf8'), /drift/);
  assert.equal(readFileSync(join(home, '.claude', 'agents', 'pbr-mechanic.md'), 'utf8'), 'mine');
});
