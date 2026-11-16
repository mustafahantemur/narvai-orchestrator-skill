// Understand-Anything graph'ının ajan gerektirmeyen adımları: tarama, import haritası, gruplama, ajan görev dosyaları.
// Kullanım: node hazirla.mjs <projectRoot> <ad> <açıklama> [--frameworks "A,B"] [--exclude "a/*,b/*"]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [root, name, description, ...rest] = process.argv.slice(2);
if (!root || !name || !description) {
  console.error('Kullanım: node hazirla.mjs <projectRoot> <ad> <açıklama> [--frameworks "A,B"] [--exclude "a/*"]');
  process.exit(1);
}
const opt = (k) => {
  const i = rest.indexOf('--' + k);
  return i >= 0 ? rest[i + 1] : '';
};
const frameworks = opt('frameworks').split(',').map((s) => s.trim()).filter(Boolean);
const exclude = ['.ua/', opt('exclude')].filter(Boolean).join(',');

const PROJECT_ROOT = path.resolve(root).replace(/\\/g, '/');
const PLUGIN_ROOT = path.join(os.homedir(), '.understand-anything-plugin').replace(/\\/g, '/');
// Script'ler plugin'in kendi kopyasından koşar: hub'daki junction yolunda core kütüphanesi çözülemiyor.
const SKILL_DIR = `${PLUGIN_ROOT}/skills/understand`;
const AGENT_DEF = `${PLUGIN_ROOT}/agents/file-analyzer.md`;
const UA = `${PROJECT_ROOT}/.ua`;
const INTER = `${UA}/intermediate`;
const TMP = `${UA}/tmp`;
fs.mkdirSync(INTER, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const run = (script, args, env) => {
  try {
    const out = execFileSync(process.execPath, [`${SKILL_DIR}/${script}`, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
    return out.toString();
  } catch (e) {
    console.error(`HATA ${script}:\n${e.stderr ? e.stderr.toString() : e.message}`);
    process.exit(1);
  }
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

const cfgPath = `${UA}/config.json`;
const cfg = fs.existsSync(cfgPath) ? readJson(cfgPath) : {};
writeJson(cfgPath, { ...cfg, autoUpdate: true, outputLanguage: 'en' });

if (!fs.existsSync(`${UA}/.understandignore`)) run('generate-ignore.mjs', [PROJECT_ROOT], { PLUGIN_ROOT });

const scanWith = (patterns) => {
  run('scan-project.mjs', [PROJECT_ROOT, `${TMP}/ua-scan-files.json`, '--exclude', patterns]);
  return readJson(`${TMP}/ua-scan-files.json`);
};
let scan = scanWith(exclude);
// Kod olmayan dev dosyalar (seed verisi, sözlük dökümü) ajanın okuma bütçesini yer, graph'a bir şey katmaz.
const skippedData = scan.files.filter((f) => f.fileCategory !== 'code' && f.sizeLines > 1500).map((f) => f.path);
if (skippedData.length) scan = scanWith([exclude, ...skippedData].join(','));

writeJson(`${TMP}/ua-import-map-input.json`, {
  projectRoot: PROJECT_ROOT,
  files: scan.files.map(({ path: p, language, fileCategory }) => ({ path: p, language, fileCategory })),
});
run('extract-import-map.mjs', [`${TMP}/ua-import-map-input.json`, `${TMP}/ua-import-map-output.json`]);
const imports = readJson(`${TMP}/ua-import-map-output.json`);

// Aracın C# çözümleyicisi `using`'i dosya yolu sanıyor ve hiç bağ bulamıyor (ölçüldü: 348 dosyada 0).
// Burada bağ, bir dosyanın görebildiği namespace'lerde tanımlı tiplere yaptığı atıflardan çıkarılır.
function csharpImportMap(files) {
  const info = new Map();
  const decl = new Map();
  for (const f of files.filter((x) => x.language === 'csharp')) {
    const src = fs
      .readFileSync(`${PROJECT_ROOT}/${f.path}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ')
      .replace(/@?"(?:[^"\\\n]|\\.)*"/g, '""');
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
const bundledCsEdges = scan.files
  .filter((f) => f.language === 'csharp')
  .reduce((a, f) => a + (imports.importMap[f.path] || []).length, 0);
if (scan.stats.byLanguage.csharp && bundledCsEdges === 0) {
  const cs = csharpImportMap(scan.files);
  Object.assign(imports.importMap, cs.map);
  imports.stats.totalEdges += cs.edges;
}

const languages = Object.keys(scan.stats.byLanguage).sort();
writeJson(`${INTER}/scan-result.json`, {
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

run('compute-batches.mjs', [PROJECT_ROOT]);
const batches = readJson(`${INTER}/batches.json`).batches;

const directive =
  '> **Language directive**: Generate all textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in **English**. Maintain technical accuracy. Domain terms that appear in Turkish in the code (entity names, enum values, UI labels) stay as written.';
// Bir ajanın sabit maliyeti ~50 bin token (ölçüldü, 2026-11-16); küçük gruplar tek ajana birleştirilir.
// Çıktı dosyaları yine özgün grup numarasıyla yazılır, birleştirme script'i başka adı sessizce atar.
const MAX_FILES = 35;
const MAX_LINES = 4000;
const units = [];
for (const b of [...batches].sort((x, y) => y.files.length - x.files.length)) {
  const w = { files: b.files.length, lines: b.files.reduce((a, f) => a + (f.sizeLines || 0), 0) };
  const u = units.find((x) => x.files + w.files <= MAX_FILES && x.lines + w.lines <= MAX_LINES);
  if (u) Object.assign(u, { batches: [...u.batches, b], files: u.files + w.files, lines: u.lines + w.lines });
  else units.push({ batches: [b], ...w });
}
for (const f of fs.readdirSync(INTER)) if (/^dispatch-batch-\d+\.md$/.test(f)) fs.rmSync(`${INTER}/${f}`);

const block = (b) => `## Batch \`${b.batchIndex}/${batches.length}\`

Output: write to \`${INTER}/batch-${b.batchIndex}.json\` (single-file mode) OR \`batch-${b.batchIndex}-part-<k>.json\` (split mode, per Step B of your output protocol).

Pre-resolved import data for this batch (use directly — do NOT re-resolve imports from source):
\`\`\`json
${JSON.stringify(b.batchImportData ?? {})}
\`\`\`

Cross-batch neighbors with their exported symbols (confidence boost for cross-batch edges):
\`\`\`json
${JSON.stringify(b.neighborMap ?? {})}
\`\`\`

Files to analyze in this batch (every entry MUST be passed through to \`batchFiles\` with all four fields — \`path\`, \`language\`, \`sizeLines\`, \`fileCategory\`):
${b.files.map((f, i) => `${i + 1}. \`${f.path}\` (${f.sizeLines} lines, language: \`${f.language}\`, fileCategory: \`${f.fileCategory}\`)`).join('\n')}
`;

units.forEach((u, k) => {
  const ids = u.batches.map((b) => b.batchIndex);
  fs.writeFileSync(
    `${INTER}/dispatch-batch-${k + 1}.md`,
    `Analyze these files and produce GraphNode and GraphEdge objects.
Project root: \`${PROJECT_ROOT}\`
Project: \`${name}\`
Languages: \`${languages.join(', ')}\`
Skill directory (for bundled scripts): \`${SKILL_DIR}\`
${
  ids.length > 1
    ? `\nThis dispatch fuses ${ids.length} batches (batchIndex ${ids.join(', ')}). Analyze them one after another. Every batch keeps its OWN output file(s), named with its original batchIndex as given in its section; never put two batches into one output file, and each output's \`batchFiles\` lists only that batch's files.\n`
    : ''
}
${u.batches.map(block).join('\n')}
**Additional context from main session:**

Project: \`${name}\` — ${description}
Languages: \`${languages.join(', ')}\`
Frameworks: \`${frameworks.join(', ')}\`

${directive}
`,
  );
});

const lines = scan.files.reduce((a, f) => a + (f.sizeLines || 0), 0);
console.log(
  JSON.stringify(
    {
      projectRoot: PROJECT_ROOT,
      uaDir: UA,
      agentDef: AGENT_DEF,
      files: scan.totalFiles,
      lines,
      byCategory: scan.stats.byCategory,
      byLanguage: scan.stats.byLanguage,
      filteredByIgnore: scan.filteredByIgnore,
      importEdges: imports.stats.totalEdges,
      groups: batches.length,
      // Workflow'a verilecek görev numaraları: dispatch-batch-<n>.md
      batches: units.map((_, k) => k + 1),
      taskFiles: units.map((u) => u.files),
      taskLines: units.map((u) => u.lines),
      bigFiles: scan.files.filter((f) => f.sizeLines > 1500).map((f) => `${f.sizeLines} ${f.path}`),
      skippedData,
    },
    null,
    1,
  ),
);
