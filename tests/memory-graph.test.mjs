import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGraph, decisionRows, difference } from '../cli/memory-graph.mjs';
import { lock } from '../cli/ortak.mjs';

const project = {
  decisions: { file: 'docs/kararlar.md', label: 'Karar', settled: 'Kesin' },
  skipTags: '^by-',
  entities: { 'iş panosu': ['iş pano', '=pano'], SG: ['=sg'], TaskInbox: ['taskinbox'] },
  relations: [['iş panosu', 'uses', 'TaskInbox']],
};
const decisions = [
  { no: '63', topic: 'İş panosu', text: 'Süreçler panelden tanımlanır.', status: 'Kesin' },
  { no: '75', topic: 'Tech Pack', text: 'SG\'deki haliyle iki aşamada.', status: 'Öneri' },
];
const record = (content, extra = {}) => ({ content, concepts: [], isLatest: true, createdAt: '2026-01-01', ...extra });
const labels = (g) => g.nodes.map((n) => n.label).sort();
const linked = (g, from, relation) => g.links.filter((l) => l.source === from.toLowerCase() && l.relation === relation).map((l) => g.nodes.find((n) => n.id === l.target).label).sort();

test('decision table: one row per line and one cell per line read the same', () => {
  const inline = '| # | Konu | Karar | Durum |\n|---|---|---|---|\n| 1 | SG | SG kaldırılacak. | Kesin |\n| 2 | Nebim | Uzun vadede çıkılır. | Öneri |\n\n## Sonraki bölüm\n';
  const spread = '| #\n | Konu\n | Karar\n | Durum\n | | 1\n | SG\n | SG kaldırılacak.\n | Kesin\n | | 2\n | Nebim\n | Uzun vadede çıkılır.\n | Öneri\n | ## Sonraki bölüm\n';
  const rows = [{ no: '1', topic: 'SG', text: 'SG kaldırılacak.', status: 'Kesin' }, { no: '2', topic: 'Nebim', text: 'Uzun vadede çıkılır.', status: 'Öneri' }];
  assert.deepEqual(decisionRows(inline), rows);
  assert.deepEqual(decisionRows(spread), rows);
  assert.deepEqual(decisionRows('no table here'), []);
});

test('a record links to its tags, its source file, the decisions it cites and the entities it mentions', () => {
  const g = buildGraph({
    decisions, project,
    records: [record('DECISION yh-pano | topic: pano (kararlar 63, 75) | decision: İş panosu TaskInbox üstünde. | status: current | source: prototip/kararlar.md, https://example.com/x.html | by: a/b',
      { concepts: ['süreç', 'by-claude'] })],
  });
  assert.deepEqual(linked(g, 'decision yh-pano', 'related_to'), ['TaskInbox', 'iş panosu', 'süreç']);
  assert.deepEqual(linked(g, 'decision yh-pano', 'uses'), ['kararlar.md']);
  assert.deepEqual(linked(g, 'decision yh-pano', 'depends_on'), ['Karar 63: İş panosu', 'Karar 75: Tech Pack (öneri)']);
  assert.deepEqual(linked(g, 'karar 75: tech pack (öneri)', 'related_to'), ['SG']);
  assert.deepEqual(linked(g, 'iş panosu', 'uses'), ['TaskInbox']);
  assert.equal(g.nodes.find((n) => n.label === 'DECISION yh-pano').file_type, 'rationale');
});

test('superseded and replaced records stay out; a name keeps one node and the spelling of the project file', () => {
  const g = buildGraph({
    project,
    records: [
      record('FACT eski | topic: x | status: superseded | by: a/b', { concepts: ['eski-etiket'] }),
      record('FACT onceki | topic: x | status: current | by: a/b', { isLatest: false }),
      record('FACT a | topic: x | status: current | by: a/b', { concepts: ['taskinbox', 'Graph'], createdAt: '2026-01-02' }),
      record('FACT b | topic: x | status: current | by: a/b', { concepts: ['graph'], createdAt: '2026-01-03' }),
      record('a note that does not follow the record format', { title: 'a note', createdAt: '2026-01-04' }),
    ],
  });
  assert.deepEqual(labels(g), ['FACT a', 'FACT b', 'Graph', 'TaskInbox', 'a note', 'iş panosu']);
});

test('difference: nothing for the same graph, additions for a new record, removals when a record goes', () => {
  const one = buildGraph({ records: [record('FACT a | topic: x', { concepts: ['t'] })] });
  const two = buildGraph({ records: [record('FACT a | topic: x', { concepts: ['t'] }), record('FACT b | topic: y', { concepts: ['t'] })] });
  assert.deepEqual(difference(one, one), { added: 0, removed: 0 });
  assert.deepEqual(difference(null, one), { added: 3, removed: 0 });
  assert.deepEqual(difference(one, two), { added: 2, removed: 0 });
  assert.deepEqual(difference(two, one), { added: 0, removed: 2 });
});

test('lock: one holder at a time; a dead holder and a removed file free it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'narvai-lock-'));
  const file = join(dir, 'x.lock');
  assert.equal(lock(file), true);
  assert.equal(lock(file), false);
  rmSync(file);
  assert.equal(lock(file), true);
  writeFileSync(file, '999999999');
  assert.equal(lock(file), true);
});
