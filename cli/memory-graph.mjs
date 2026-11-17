import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cfg, home, lock, readJson, storeRoot, tilde } from './ortak.mjs';

// The knowledge graph of the shared memory. AgentMemory fills its graph from session observations only, so records
// saved with memory_save never reach it. This builds the graph from the records and imports it, without an LLM.

// "İş" lowercases to i + combining dot; without the dot one lowercase alias matches both spellings.
const norm = (s) => s.toLowerCase().replace(/̇/g, '');
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
// Alias forms in a project file: "=sg" whole word, "^trend" word start, anything else a plain pattern.
const alias = (a) => new RegExp(a[0] === '=' ? B + a.slice(1) + E : a[0] === '^' ? B + a.slice(1) : a, 'u');
const leaf = (p) => p.split(/[\\/]/).pop();

// Rows of the first markdown table whose first column is "#": number, topic, text, status. A row may sit on one line
// or spread one cell per line, as a document export writes it.
export function decisionRows(text) {
  const at = text.indexOf('| #');
  if (at < 0) return [];
  const cells = text.slice(at).split('|').map((c) => c.replace(/\s+/g, ' ').trim()).filter((c) => c && !/^:?-+:?$/.test(c));
  const rows = [];
  for (let i = 4; i + 3 < cells.length && /^\d+$/.test(cells[i]); i += 4) rows.push({ no: cells[i], topic: cells[i + 1], text: cells[i + 2], status: cells[i + 3] });
  return rows;
}

// Nodes: one per current record, per concept tag, per source file, per decision row and per entity the project file
// names. Links: a record to its tags, its files, the decisions it cites and the entities its text mentions.
export function buildGraph({ records = [], decisions = [], project = {} }) {
  const entities = Object.entries(project.entities ?? {}).map(([name, aliases]) => ({ name, tests: aliases.map(alias) }));
  const { label = 'Decision', settled, file } = project.decisions ?? {};
  const skip = project.skipTags && new RegExp(project.skipTags);
  // One node per name whatever its casing; the spelling in the project file wins, so labels do not flip between runs.
  const spelling = new Map(entities.map((e) => [norm(e.name), e.name]));
  const nodes = new Map();
  const links = new Map();
  // file_type decides the node type on import: rationale -> decision, concept -> concept, none + extension -> file.
  const node = (name, file_type, source_file) => {
    const id = norm(name);
    if (!nodes.has(id)) nodes.set(id, { id, label: spelling.get(id) ?? name, ...(file_type && { file_type }), ...(source_file && { source_file }) });
    return id;
  };
  const link = (source, target, relation) => { if (source !== target) links.set(`${source}|${target}|${relation}`, { source, target, relation, confidence: 'EXTRACTED' }); };
  const mentions = (from, text) => { const t = norm(text); for (const e of entities) if (e.tests.some((r) => r.test(t))) link(from, node(e.name, 'concept'), 'related_to'); };

  const byNo = new Map();
  for (const d of decisions) {
    const id = node(`${label} ${d.no}: ${d.topic}${d.status && d.status !== settled ? ` (${norm(d.status)})` : ''}`, 'rationale', file && leaf(file));
    byNo.set(d.no, id);
    mentions(id, `${d.topic} ${d.text}`);
  }
  // "karar 6" and "kararlar 12, 19" both cite decisions when the label is "Karar".
  const word = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cites = new RegExp(`${B}${word}\\p{L}*\\s+(\\d+(?:,\\s*\\d+)*)`, 'giu');

  // Oldest first, so a tag keeps the spelling it was first written with.
  const current = records.filter((m) => m.isLatest !== false && !/\|\s*status:\s*superseded/.test(m.content))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const m of current) {
    const head = m.content.match(/^(\w+)\s+(\S+)\s*\|/);
    const source = m.content.match(/\|\s*source:\s*([^|]+)/)?.[1].trim();
    const rec = node(head ? `${head[1]} ${head[2]}` : (m.title ?? m.content).slice(0, 60), head?.[1] === 'DECISION' ? 'rationale' : 'concept', source);
    for (const c of m.concepts ?? []) if (!skip?.test(c)) link(rec, node(c, 'concept'), 'related_to');
    for (const f of source?.replace(/\w+:\/\/\S+/g, '').match(/[\w./\\-]+\.(?:md|txt|json|ya?ml|html|sed|mjs|js|tsx?|cs|py)\b/g) ?? []) link(rec, node(leaf(f)), 'uses');
    for (const hit of m.content.matchAll(cites)) for (const no of hit[1].match(/\d+/g)) if (byNo.has(no)) link(rec, byNo.get(no), 'depends_on');
    mentions(rec, m.content);
  }
  for (const [a, relation, b] of project.relations ?? []) link(node(a, 'concept'), node(b, 'concept'), relation);
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

const keys = (g) => new Set([...(g?.nodes ?? []).map((n) => `n|${n.id}|${n.label}|${n.file_type ?? ''}`), ...(g?.links ?? []).map((l) => `l|${l.source}|${l.target}|${l.relation}`)]);
export function difference(was, now) {
  const a = keys(was);
  const b = keys(now);
  return { added: [...b].filter((k) => !a.has(k)).length, removed: [...a].filter((k) => !b.has(k)).length };
}

function api() {
  const c = cfg();
  if (!c.memory?.url) return null;
  const secretFile = join(home(), '.agentmemory', 'secret');
  const secret = process.env.AGENTMEMORY_SECRET ?? (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : '');
  const base = `${new URL(c.memory.url).origin}/agentmemory`;
  const call = async (path, body) => (await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(secret && { authorization: `Bearer ${secret}` }), ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(body ? 180_000 : 10_000),
  })).json();
  return { project: c.memoryProject ?? 'shared', call };
}

async function inputs(a) {
  const records = [];
  for (;;) {
    const page = await a.call(`/memories?project=${encodeURIComponent(a.project)}&limit=200&offset=${records.length}`);
    records.push(...page.memories ?? []);
    if (!page.memories?.length || records.length >= page.total) break;
  }
  const project = readJson(join(storeRoot(), 'graph', 'memory', `${a.project}.json`), {});
  const file = project.decisions?.file && tilde(project.decisions.file);
  return { records, project, decisions: file && existsSync(file) ? decisionRows(readFileSync(file, 'utf8')) : [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// An import runs on after its request has returned or timed out; the index reports ready when it has finished.
async function settled(a, done) {
  for (let i = 0; i < 60; i++) {
    const s = await a.call('/graph/index').catch(() => null);
    if (s?.ready && done(s)) return s;
    await sleep(5000);
  }
  return null;
}

async function once(a, { reset, migrate, check }) {
  const graph = buildGraph(await inputs(a));
  const size = `${graph.nodes.length} nodes, ${graph.links.length} relations`;
  let index = await a.call('/graph/index');
  if (index.state === 'needs-migration') {
    // AgentMemory wants a say-so before it builds the index of an existing graph store: that reads the whole store.
    if (!migrate) return { line: 'memory graph: AgentMemory has not built its graph index yet; run narvai graph memory --migrate once' };
    await a.call('/graph/index/migrate', { allowLegacyScan: true });
    index = await settled(a, () => true);
    if (!index) return { line: 'memory graph: the graph index did not become ready; see agentmemory graph-index status' };
  }
  // The import only accepts files under ~/.agentmemory. <project>.json there is the graph last imported.
  const out = join(home(), '.agentmemory', 'graph-import', `${a.project}.json`);
  const { added, removed } = difference(index.nodes > 0 ? readJson(out, null) : null, graph);
  if (!added && !removed && !reset) return { line: `memory graph: current (${size})` };
  if (check) return { line: `memory graph: stale, ${added} to add and ${removed} to remove; narvai graph memory` };

  const next = out.replace(/\.json$/, '.next.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(next, JSON.stringify(graph));
  // An import only adds. When something went away, the graph starts empty first.
  if (removed || reset) await a.call('/graph/reset', {});
  await a.call('/graph/import-graphify', { path: next }).catch(() => {});
  const end = await settled(a, (s) => s.nodes >= graph.nodes.length && s.edges >= graph.links.length);
  if (!end) return { line: `memory graph: the import did not finish (${size}); see agentmemory graph-index status` };
  renameSync(next, out);
  return { line: `memory graph: imported, ${added} added and ${removed} removed (${end.nodes} nodes, ${end.edges} relations)`, imported: true };
}

// Brings the graph in line with the records and says what it did in one line; null when no shared memory is set up.
// check: report only. wait: seconds to hold off first, for a record that is being saved right now.
export async function memoryGraph({ reset = false, migrate = false, check = false, wait = 0 } = {}) {
  const a = api();
  if (!a) return null;
  if (wait) await sleep(wait * 1000);
  const held = join(storeRoot(), 'graph', 'memory.lock');
  try {
    if (check) return (await once(a, { check })).line;
    mkdirSync(dirname(held), { recursive: true });
    if (!lock(held)) return 'memory graph: a sync is already running';
    try {
      const first = await once(a, { reset, migrate });
      // Records saved while an import ran are picked up by the next pass; at most 3 passes.
      for (let pass = 1, last = first; pass < 3 && last.imported; pass++) last = await once(a, { migrate });
      return first.line;
    } finally { rmSync(held, { force: true }); }
  } catch (e) {
    return `memory graph: not synced (${String(e?.message ?? e).split('\n')[0]})`;
  }
}
