// Understand-Anything graph'ının ajan gerektirmeyen adımları: tarama, import haritası, gruplama, ajan görev dosyaları.
// Kullanım: node hazirla.mjs <projectRoot> <ad> <açıklama> [--frameworks "A,B"] [--exclude "a/*,b/*"]
import fs from 'node:fs';
import { PLUGIN_ROOT, SKILL_DIR, parseArgs, readJson, runSkill, tara, uaPaths, writeJson } from './ua-ortak.mjs';

const { root, name, description, frameworks, exclude } = parseArgs(process.argv.slice(2));
if (!root || !name || !description) {
  console.error('Kullanım: node hazirla.mjs <projectRoot> <ad> <açıklama> [--frameworks "A,B"] [--exclude "a/*"]');
  process.exit(1);
}
const { root: PROJECT_ROOT, ua: UA, inter: INTER } = uaPaths(root);
const AGENT_DEF = `${PLUGIN_ROOT}/agents/file-analyzer.md`;
const run = (script, args) => {
  try {
    return runSkill(script, args);
  } catch (e) {
    console.error(`HATA ${e.message}`);
    process.exit(1);
  }
};

fs.mkdirSync(UA, { recursive: true });
const cfgPath = `${UA}/config.json`;
// Model yolu graph'ı devralınca script işareti kalkar; yoksa ua-uret bir sonraki koşuda özetleri hasat etmez.
const { generator: _g, ...cfg } = fs.existsSync(cfgPath) ? readJson(cfgPath) : {};
writeJson(cfgPath, { ...cfg, autoUpdate: true, outputLanguage: 'en' });

let scanned;
try {
  scanned = tara(PROJECT_ROOT, { name, description, frameworks, exclude });
} catch (e) {
  console.error(`HATA ${e.message}`);
  process.exit(1);
}
const { scan, languages, importEdges, skippedData } = scanned;

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
      importEdges,
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
