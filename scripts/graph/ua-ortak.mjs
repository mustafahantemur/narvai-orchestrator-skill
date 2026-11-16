// Understand-Anything graph'ının model yolu (hazirla/bitir) ile script yolu (ua-uret) arasında ortak adımlar:
// tarama + import haritası, doğrulama ve kaydetme.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PLUGIN_ROOT = path.join(os.homedir(), '.understand-anything-plugin').replace(/\\/g, '/');
// Script'ler plugin'in kendi kopyasından koşar: hub'daki junction yolunda core kütüphanesi çözülemiyor.
export const SKILL_DIR = `${PLUGIN_ROOT}/skills/understand`;
const narvaiCfg = path.join(os.homedir(), '.narvai', 'config.json');
const storeRoot = fs.existsSync(narvaiCfg) ? JSON.parse(fs.readFileSync(narvaiCfg, 'utf8')).storeRoot : 'C:/Projects/AI/Features/_harness';
export const STORE = `${storeRoot.replace(/\\/g, '/')}/graph`;
export const FILE_LEVEL = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
// Varsayılan ignore listesinde olmayan ikili ve model dosyaları; hiçbiri analiz edilmez.
const BINARY = ['*.onnx', '*.onnx_data*', '*.webp', '*.bmp', '*.tif', '*.tiff', '*.otf', '*.bin', '*.pt', '*.pth', '*.safetensors', '*.glb', '*.gltf', '*.fbx', '*.obj', '*.exr', '*.hdr', '*.dll', '*.exe', '*.pdb', '*.wasm', '*.mov', '*.wav', '*.7z', '*.xlsx', '*.docx'];

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
export const uaPaths = (projectRoot) => {
  const root = path.resolve(projectRoot).replace(/\\/g, '/');
  return { root, ua: `${root}/.ua`, inter: `${root}/.ua/intermediate`, tmp: `${root}/.ua/tmp` };
};

export const runSkill = (script, args, env) => {
  try {
    return execFileSync(process.execPath, [`${SKILL_DIR}/${script}`, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    }).toString();
  } catch (e) {
    throw new Error(`${script}: ${e.stderr ? e.stderr.toString() : e.message}`);
  }
};

export const parseArgs = (argv) => {
  const [root, name, description, ...rest] = argv;
  const opt = (k) => {
    const i = rest.indexOf('--' + k);
    return i >= 0 ? rest[i + 1] || '' : '';
  };
  return {
    root,
    name,
    description,
    frameworks: opt('frameworks').split(',').map((s) => s.trim()).filter(Boolean),
    exclude: opt('exclude'),
  };
};

// Tarama, import haritası ve scan-result.json. Döner: { scan, importMap, importEdges, skippedData }.
export function tara(projectRoot, { name, description, frameworks, exclude }) {
  const P = uaPaths(projectRoot);
  fs.mkdirSync(P.inter, { recursive: true });
  fs.mkdirSync(P.tmp, { recursive: true });
  if (!fs.existsSync(`${P.ua}/.understandignore`)) runSkill('generate-ignore.mjs', [P.root], { PLUGIN_ROOT });

  const patterns = ['.ua/', ...BINARY, exclude].filter(Boolean).join(',');
  const scanWith = (p) => {
    runSkill('scan-project.mjs', [P.root, `${P.tmp}/ua-scan-files.json`, '--exclude', p]);
    return readJson(`${P.tmp}/ua-scan-files.json`);
  };
  let scan = scanWith(patterns);
  // Kod olmayan dev dosyalar (seed verisi, sözlük dökümü) okuma bütçesini yer, graph'a bir şey katmaz.
  const skippedData = scan.files.filter((f) => f.fileCategory !== 'code' && f.sizeLines > 1500).map((f) => f.path);
  if (skippedData.length) scan = scanWith([patterns, ...skippedData].join(','));

  writeJson(`${P.tmp}/ua-import-map-input.json`, {
    projectRoot: P.root,
    files: scan.files.map(({ path: p, language, fileCategory }) => ({ path: p, language, fileCategory })),
  });
  runSkill('extract-import-map.mjs', [`${P.tmp}/ua-import-map-input.json`, `${P.tmp}/ua-import-map-output.json`]);
  const imports = readJson(`${P.tmp}/ua-import-map-output.json`);

  const bundledCsEdges = scan.files
    .filter((f) => f.language === 'csharp')
    .reduce((a, f) => a + (imports.importMap[f.path] || []).length, 0);
  if (scan.stats.byLanguage.csharp && bundledCsEdges === 0) {
    const cs = csharpImportMap(P.root, scan.files);
    Object.assign(imports.importMap, cs.map);
    imports.stats.totalEdges += cs.edges;
  }

  const languages = Object.keys(scan.stats.byLanguage).sort();
  writeJson(`${P.inter}/scan-result.json`, {
    name,
    description,
    languages,
    frameworks,
    files: scan.files,
    totalFiles: scan.totalFiles,
    filteredByIgnore: scan.filteredByIgnore,
    estimatedComplexity: scan.estimatedComplexity,
    importMap: imports.importMap,
  });
  return { scan, languages, importMap: imports.importMap, importEdges: imports.stats.totalEdges, skippedData };
}

export const stripCsharp = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/@?"(?:[^"\\\n]|\\.)*"/g, '""');

// Aracın C# çözümleyicisi `using`'i dosya yolu sanıyor ve hiç bağ bulamıyor (ölçüldü: 348 dosyada 0).
// Burada bağ, bir dosyanın görebildiği namespace'lerde tanımlı tiplere yaptığı atıflardan çıkarılır.
function csharpImportMap(root, files) {
  const info = new Map();
  const decl = new Map();
  for (const f of files.filter((x) => x.language === 'csharp')) {
    const src = stripCsharp(fs.readFileSync(`${root}/${f.path}`, 'utf8'));
    const ns = (src.match(/^\s*namespace\s+([\w.]+)/m) || [])[1] || '';
    const usings = new Set([...src.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/gm)].map((m) => m[1]));
    const types = new Set(
      [...src.matchAll(/\b(?:class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+([A-Z]\w*)/g)].map((m) => m[1]),
    );
    info.set(f.path, { ns, usings, types, idents: new Set(src.match(/\b[A-Z]\w+\b/g) || []) });
    for (const t of types) decl.set(t, [...(decl.get(t) || []), { path: f.path, ns }]);
  }
  const map = {};
  let edges = 0;
  for (const [p, i] of info) {
    const out = new Set();
    for (const id of i.idents) {
      if (i.types.has(id)) continue;
      const seen = (decl.get(id) || []).filter(
        (d) => d.path !== p && (d.ns === i.ns || i.usings.has(d.ns) || (d.ns && i.ns.startsWith(d.ns + '.'))),
      );
      // ponytail: aynı adı taşıyan 3'ten fazla görünür tip varsa bağ kurulmaz; kesin çözüm için Roslyn gerekir.
      if (seen.length && seen.length <= 3) for (const d of seen) out.add(d.path);
    }
    map[p] = [...out].sort();
    edges += out.size;
  }
  return { map, edges };
}

// SKILL.md Phase 6'daki satır içi doğrulayıcının aynısı.
export function dogrula(graph) {
  const issues = [];
  const warnings = [];
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) return issues.push(`Node[${i}] missing id`);
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const assigned = new Map();
  for (const layer of graph.layers) {
    for (const k of ['id', 'name', 'description', 'nodeIds']) if (!layer[k]) issues.push(`Layer missing ${k}`);
    for (const id of layer.nodeIds || []) {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    }
  }
  for (const n of graph.nodes) if (FILE_LEVEL.has(n.type) && !assigned.has(n.id)) issues.push(`File node '${n.id}' not in any layer`);
  graph.tour.forEach((step, i) => {
    for (const k of ['order', 'title', 'description', 'nodeIds']) if (step[k] === undefined || step[k] === '') issues.push(`Tour step[${i}] missing ${k}`);
    for (const id of step.nodeIds || []) if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
  });
  const withEdges = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  for (const n of graph.nodes) if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  return { issues, warnings };
}

// knowledge-graph.json, parmak izleri, meta.json, intermediate temizliği ve dizin kaydı.
export function kaydet(projectRoot, scan, { nodes, edges, layers, tour }, indexExtra = {}) {
  const P = uaPaths(projectRoot);
  const commit = execFileSync('git', ['-C', P.root, 'rev-parse', 'HEAD']).toString().trim();
  const now = new Date().toISOString();
  writeJson(`${P.ua}/knowledge-graph.json`, {
    version: '1.0.0',
    project: { name: scan.name, languages: scan.languages, frameworks: scan.frameworks, description: scan.description, analyzedAt: now, gitCommitHash: commit },
    nodes,
    edges,
    layers,
    tour,
  });

  writeJson(`${P.inter}/fingerprint-input.json`, { projectRoot: P.root, filePaths: scan.files.map((f) => f.path), gitCommitHash: commit });
  const fp = runSkill('build-fingerprints.mjs', [`${P.inter}/fingerprint-input.json`]);
  if (!fp.includes('Fingerprints baseline:')) throw new Error(`Parmak izi üretilemedi, meta yazılmadı:\n${fp}`);
  writeJson(`${P.ua}/meta.json`, { lastAnalyzedAt: now, gitCommitHash: commit, version: '1.0.0', analyzedFiles: scan.totalFiles });

  const trash = `${P.ua}/.trash-${Math.floor(Date.now() / 1000)}`;
  fs.mkdirSync(trash, { recursive: true });
  for (const f of fs.readdirSync(P.inter)) if (f !== 'scan-result.json') fs.renameSync(`${P.inter}/${f}`, `${trash}/${f}`);
  if (fs.existsSync(P.tmp)) fs.renameSync(P.tmp, `${trash}/tmp`);

  const indexPath = `${STORE}/index.json`;
  const index = fs.existsSync(indexPath) ? readJson(indexPath) : { graphs: [] };
  const rel = path.posix.relative(STORE, `${P.ua}/knowledge-graph.json`);
  const withEdge = new Set(edges.flatMap((e) => [e.source, e.target]));
  const entry = {
    name: scan.name,
    graph: rel,
    commit,
    analyzedAt: now,
    files: scan.totalFiles,
    nodes: nodes.length,
    edges: edges.length,
    layers: layers.map((l) => `${l.name} (${l.nodeIds.length})`),
    tourSteps: tour.length,
    orphanNodes: nodes.filter((n) => !withEdge.has(n.id)).length,
    ...indexExtra,
  };
  index.graphs = [...(index.graphs || []).filter((g) => g.graph !== rel), entry].sort((a, b) => a.graph.localeCompare(b.graph));
  writeJson(indexPath, index);
  return entry;
}
