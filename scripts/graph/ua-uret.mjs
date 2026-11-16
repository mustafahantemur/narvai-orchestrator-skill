// Understand-Anything graph'ını model çağırmadan üretir (sıfır token). Çıktı şekli /understand ile aynıdır.
// Kullanım: node ua-uret.mjs <projectRoot> <ad> <açıklama> [--frameworks "A,B"] [--exclude "a/**,b/**"]
// <projectRoot>/.ua/summaries.json varsa ({ "<nodeId>": { summary, tags } }) özet ve etiketleri ezer.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { FILE_LEVEL, SKILL_DIR, dogrula, kaydet, parseArgs, readJson, tara, uaPaths, writeJson } from './ua-ortak.mjs';
import { bareType, bodyFacts, clean, csharpFacts, docAbove, genericArgs, markdownSummary, propNames, returnType, tsFacts, typeNames } from './ua-kaynak.mjs';

const started = Date.now();
const args = parseArgs(process.argv.slice(2));
if (!args.root || !args.name || !args.description) {
  console.error('Kullanım: node ua-uret.mjs <projectRoot> <ad> <açıklama> [--frameworks "A,B"] [--exclude "a/**"]');
  process.exit(1);
}
const P = uaPaths(args.root);
const WEIGHT = { contains: 1, inherits: 0.9, implements: 0.9, calls: 0.8, exports: 0.8, defines_schema: 0.8, imports: 0.7, migrates: 0.7, depends_on: 0.6, configures: 0.6 };
const NOISE_DEPS = new Set(['CancellationToken', 'ILogger', 'IOptions', 'IOptionsMonitor', 'IOptionsSnapshot', 'TimeProvider', 'IConfiguration', 'IServiceProvider', 'IServiceScopeFactory', 'ISender', 'IMediator', 'IPublisher', 'IHttpContextAccessor', 'Guid', 'String', 'Func', 'Action', 'Task', 'IReadOnlyList', 'IEnumerable', 'List', 'Dictionary']);
const NOISE_CALLS = /^(ConfigureAwait|ThrowIfNull|ThrowIfNullOrWhiteSpace|nameof|ToString|ToList|ToArray|Select|Where|Any|First|FirstOrDefault|Count|Equals|GetHashCode|Add|Contains|Trim|Format|Join|Parse|Create|Ok|NotFound|Problem|log|map|filter|push|includes|then)$/;

const list = (a, n = 6) => (a.length > n ? `${a.slice(0, n).join(', ')} and ${a.length - n} more` : a.join(', '));
const uniq = (a) => [...new Set(a.filter(Boolean))];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s) => clean(cap(s.trim()).replace(/[.;,\s]*$/, '.'));
const cx = (n, a, b) => (n < a ? 'simple' : n <= b ? 'moderate' : 'complex');
const base = (p) => path.posix.basename(p);

// --- 1. Model graph'ının özetlerini hasat et, script işaretini koy ---
fs.mkdirSync(P.ua, { recursive: true });
const cfgPath = `${P.ua}/config.json`;
const sidecarPath = `${P.ua}/summaries.json`;
const oldCfg = fs.existsSync(cfgPath) ? readJson(cfgPath) : {};
const sidecar = fs.existsSync(sidecarPath) ? readJson(sidecarPath) : {};
let harvested = 0;
if (oldCfg.generator !== 'script' && fs.existsSync(`${P.ua}/knowledge-graph.json`)) {
  for (const n of readJson(`${P.ua}/knowledge-graph.json`).nodes || []) {
    if (!n.summary || sidecar[n.id]) continue;
    sidecar[n.id] = { summary: n.summary, tags: n.tags || [] };
    harvested++;
  }
  writeJson(sidecarPath, sidecar);
}
writeJson(cfgPath, { ...oldCfg, autoUpdate: false, outputLanguage: 'en', generator: 'script' });

// --- 2. Tarama ve yapı ---
const { scan, languages, importMap } = tara(P.root, args);
const scanResult = { ...scan, name: args.name, description: args.description, languages, frameworks: args.frameworks };

async function structure(files) {
  const CHUNK = 250;
  const chunks = [];
  for (let i = 0; i < files.length; i += CHUNK) chunks.push(files.slice(i, i + CHUNK));
  const out = new Map();
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const k = next++;
      const inp = `${P.tmp}/ua-structure-in-${k}.json`;
      const res = `${P.tmp}/ua-structure-out-${k}.json`;
      writeJson(inp, { projectRoot: P.root, batchFiles: chunks[k], batchImportData: {} });
      await promisify(execFile)(process.execPath, [`${SKILL_DIR}/extract-structure.mjs`, inp, res], { maxBuffer: 64 << 20 });
      for (const r of readJson(res).results) out.set(r.path, r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, worker));
  return out;
}
const structures = await structure(scan.files.filter((f) => ['code', 'script', 'markup'].includes(f.fileCategory)));

function fileType(f, src) {
  const p = f.path.toLowerCase();
  if (f.fileCategory === 'config') return 'config';
  if (f.fileCategory === 'docs') return 'document';
  if (f.fileCategory === 'infra')
    return /\.github\/workflows\/|gitlab-ci|jenkinsfile|azure-pipelines|\.circleci\//.test(p) ? 'pipeline' : /\.tf(vars)?$|cloudformation|vagrantfile/.test(p) ? 'resource' : 'service';
  if (f.fileCategory === 'data') {
    if (/\.(graphql|gql|proto|prisma)$/.test(p)) return 'schema';
    if (/openapi|swagger/.test(base(p))) return 'endpoint';
    if (/\.sql$/.test(p) && /create\s+table/i.test(src)) return 'table';
  }
  return 'file';
}

const recs = scan.files.map((f) => {
  const src = fs.readFileSync(`${P.root}/${f.path}`, 'utf8');
  const type = fileType(f, src);
  const r = structures.get(f.path) || {};
  return { f, src, type, id: `${type}:${f.path}`, r, fns: [], tsx: /\.(tsx|jsx)$/.test(f.path), ts: /\.(m?[jt]sx?)$/.test(f.path) };
});
const recByPath = new Map(recs.map((x) => [x.f.path, x]));

// --- 3. Düğümler ---
const nodes = new Map();
const addNode = (n) => (nodes.has(n.id) ? null : (nodes.set(n.id, n), n));
const edges = new Map();
const addEdge = (source, target, type) => {
  if (!source || !target || source === target) return;
  const k = `${source}|${target}|${type}`;
  if (!edges.has(k)) edges.set(k, { source, target, type, direction: 'forward', weight: WEIGHT[type] ?? 0.5 });
};

for (const rec of recs) {
  const lines = rec.r.nonEmptyLines ?? rec.f.sizeLines;
  rec.node = addNode({ id: rec.id, type: rec.type, name: base(rec.f.path), filePath: rec.f.path, summary: '', tags: [], complexity: cx(lines, 50, 200) });
}

const typeIndex = new Map();
const globalUsings = new Set();
for (const rec of recs.filter((x) => x.f.language === 'csharp')) {
  rec.cs = csharpFacts(rec.src);
  rec.cs.globalUsings.forEach((u) => globalUsings.add(u));
  for (const t of rec.cs.types) {
    Object.assign(t, { id: `class:${rec.f.path}:${t.name}`, rec, ns: rec.cs.ns, path: rec.f.path });
    t.node = addNode({ id: t.id, type: 'class', name: t.name, filePath: rec.f.path, lineRange: [t.startLine, t.endLine], summary: '', tags: [], complexity: cx(t.endLine - t.startLine + 1, 30, 150) });
    typeIndex.set(t.name, [...(typeIndex.get(t.name) || []), t]);
  }
}
for (const rec of recs.filter((x) => x.cs)) rec.usings = new Set([...rec.cs.usings, ...globalUsings]);

const ownerOf = (rec, a, b = a) =>
  (rec.cs?.types || []).filter((t) => t.startLine <= a && b <= t.endLine).sort((x, y) => x.endLine - x.startLine - (y.endLine - y.startLine))[0];

for (const rec of recs) {
  const exported = new Set((rec.r.exports || []).map((e) => e.name));
  rec.lines = rec.cs?.lines || rec.src.split(/\r?\n/);
  // C# ve TS dışındaki diller (Python, shell...) de fonksiyon düğümü üretir; TS gerçekleri onlarda boş kalır.
  rec.tsf = { apis: [], zodSchemas: [], onlyTypes: false };
  if (rec.ts) {
    rec.tsf = tsFacts(rec.src);
    for (const c of rec.r.classes || []) {
      if (!exported.has(c.name) && c.methods.length < 2 && c.endLine - c.startLine < 19) continue;
      addNode({ id: `class:${rec.f.path}:${c.name}`, type: 'class', name: c.name, filePath: rec.f.path, lineRange: [c.startLine, c.endLine], summary: '', tags: [], complexity: cx(c.endLine - c.startLine + 1, 30, 150), _ts: { c, exported: exported.has(c.name) } });
    }
  }
  for (const fn of rec.r.functions || []) {
    const span = fn.endLine - fn.startLine + 1;
    const owner = ownerOf(rec, fn.startLine, fn.endLine);
    const isExported = exported.has(fn.name) && (!owner || owner.mods.has('public'));
    const isCtor = owner && fn.name === owner.name;
    if (!(span >= 10 || (isExported && span >= 3 && !isCtor))) continue;
    const id = `function:${rec.f.path}:${fn.name}`;
    const node = addNode({ id, type: 'function', name: fn.name, filePath: rec.f.path, lineRange: [fn.startLine, fn.endLine], summary: '', tags: [], complexity: cx(span, 30, 100) });
    if (node) rec.fns.push({ ...fn, id, owner, exported: isExported, node });
  }
}
const fnByFile = new Map(recs.map((rec) => [rec.f.path, new Map(rec.fns.map((fn) => [fn.name, fn]))]));

const csRecs = recs.filter((x) => x.cs);
const schemas = uniq(csRecs.filter((x) => !/\/Migrations\//.test(x.f.path)).map((x) => x.cs.defaultSchema));
const tablesByName = new Map();
for (const rec of csRecs) {
  for (const r of rec.cs.routes) {
    r.node = addNode({ id: `endpoint:${rec.f.path}:${r.method} ${r.route}`, type: 'endpoint', name: `${r.method} ${r.route}`, filePath: rec.f.path, lineRange: [r.line, r.line], summary: '', tags: [], complexity: 'simple' });
  }
  for (const t of rec.cs.tables) {
    const schema = t.schema || rec.cs.defaultSchema || (schemas.length === 1 ? schemas[0] : '');
    t.qualified = schema ? `${schema}.${t.name}` : t.name;
    t.node = addNode({ id: `table:${rec.f.path}:${t.qualified}`, type: 'table', name: t.qualified, filePath: rec.f.path, lineRange: [t.line, t.line], summary: '', tags: [], complexity: 'simple' });
    if (t.node) tablesByName.set(t.qualified, [...(tablesByName.get(t.qualified) || []), t.node.id]);
  }
}

// --- 4. Tip çözümü: aynı ad birden çok görünür tipe çıkarsa bağ kurulmaz ---
function resolveType(raw, rec) {
  const short = bareType(raw);
  const c = typeIndex.get(short);
  if (!c || !rec.cs) return null;
  const qual = raw.replace(/<.*$/s, '').split('.').slice(0, -1).join('.');
  let hit;
  if (qual) hit = c.filter((t) => t.ns === qual || t.ns.endsWith('.' + qual));
  else {
    const own = c.filter((t) => t.path === rec.f.path);
    const ns = rec.cs.ns;
    hit = own.length ? own : c.filter((t) => t.ns === ns || rec.usings.has(t.ns) || (t.ns && ns.startsWith(t.ns + '.')));
  }
  return hit.length === 1 ? hit[0] : null;
}
const handlers = new Map();
for (const rec of csRecs)
  for (const t of rec.cs.types) {
    const b = t.bases.find((x) => /^IRequestHandler</.test(x));
    const req = b && resolveType(genericArgs(b)[0] || '', rec);
    if (req) handlers.set(req, [...(handlers.get(req) || []), t]);
  }
const handlerOf = (req) => (req && handlers.get(req)?.length === 1 ? handlers.get(req)[0] : null);
const enclosing = (rec, line) => {
  const fn = rec.fns.filter((f) => f.startLine <= line && line <= f.endLine).sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
  return fn?.id || ownerOf(rec, line)?.id || rec.id;
};
const depTypes = (t) =>
  t.kind === 'record'
    ? []
    : uniq([...(t.params || []), ...t.ctorParams].flatMap((p) => typeNames(p.type)))
        .filter((n) => !NOISE_DEPS.has(n) && n !== t.name);

// --- 5. Kenarlar ---
for (const rec of recs) {
  for (const p of importMap[rec.f.path] || []) addEdge(rec.id, recByPath.get(p)?.id, 'imports');
  for (const fn of rec.fns) {
    addEdge(rec.id, fn.id, 'contains');
    if (fn.exported) addEdge(rec.id, fn.id, 'exports');
  }
}

for (const rec of csRecs) {
  for (const t of rec.cs.types) {
    addEdge(rec.id, t.id, 'contains');
    if (t.mods.has('public')) addEdge(rec.id, t.id, 'exports');
    for (const b of t.bases) {
      const target = resolveType(b, rec);
      if (target && target !== t) addEdge(t.id, target.id, target.kind === 'interface' ? 'implements' : 'inherits');
      for (const g of genericArgs(b)) {
        const x = resolveType(g, rec);
        if (x && x !== t) addEdge(t.id, x.id, /^INotificationHandler</.test(b) ? 'subscribes' : 'depends_on');
      }
    }
    for (const n of depTypes(t)) {
      const x = resolveType(n, rec);
      if (x && x !== t) addEdge(t.id, x.id, 'depends_on');
    }
    if (rec.cs.rabbit && t.bases.some((b) => /^(BackgroundService|IHostedService)$/.test(b)))
      for (const d of rec.cs.deserializes.filter((d) => d.line >= t.startLine && d.line <= t.endLine)) addEdge(t.id, resolveType(d.qual, rec)?.id, 'subscribes');
  }
  for (const s of rec.cs.sends) addEdge(enclosing(rec, s.line), handlerOf(resolveType(s.qual, rec))?.id, 'calls');
  for (const p of rec.cs.publishes) addEdge(enclosing(rec, p.line), resolveType(p.qual, rec)?.id, 'publishes');
  for (const r of rec.cs.routes) {
    if (!r.node) continue;
    addEdge(rec.id, r.node.id, 'contains');
    const fn = r.handlerName && (rec.r.functions || []).find((f) => f.name === r.handlerName);
    const text = r.span + (fn ? rec.cs.code.split('\n').slice(fn.startLine - 1, fn.endLine).join('\n') : '');
    r.requests = uniq([...text.matchAll(/\bnew\s+([\w.]+)\s*[({]/g)].map((m) => resolveType(m[1], rec))).filter((x) => handlerOf(x) || x.bases.some((b) => /^IRequest(<|$)/.test(b)));
    for (const req of r.requests) addEdge(r.node.id, (handlerOf(req) || req).id, 'routes');
  }
  for (const t of rec.cs.tables) {
    if (!t.node) continue;
    addEdge(rec.id, t.node.id, 'contains');
    t.config = ownerOf(rec, t.line);
    if (t.config) addEdge(t.config.id, t.node.id, 'defines_schema');
    t.entityType = t.entity && resolveType(t.entity, rec);
    if (t.entityType) addEdge(t.node.id, t.entityType.id, 'related');
  }
  for (const mt of rec.cs.migrationTables) {
    const q = mt.schema ? `${mt.schema}.${mt.name}` : schemas.length === 1 ? `${schemas[0]}.${mt.name}` : mt.name;
    const hit = tablesByName.get(q);
    if (hit?.length === 1) addEdge(rec.id, hit[0], 'migrates');
  }
}

// tree-sitter çağrı grafiği: hedef, aynı dosyada ya da import edilen dosyalarda tek bir fonksiyon düğümüyse bağlanır.
function callTargets(rec, fn) {
  const out = [];
  for (const c of (rec.r.callGraph || []).filter((x) => x.caller === fn.name)) {
    if (!/^[\w.]+$/.test(c.callee)) continue;
    const parts = c.callee.split('.');
    const name = parts.pop();
    const qual = parts.join('.');
    let files;
    if (!qual || qual === 'this') files = rec.cs ? [rec.f.path] : [rec.f.path, ...(importMap[rec.f.path] || [])];
    else if (rec.cs && /^[A-Z]/.test(qual)) files = [resolveType(qual, rec)?.path];
    else if (rec.cs) files = importMap[rec.f.path] || [];
    else continue;
    const hits = uniq(files).map((p) => fnByFile.get(p)?.get(name)).filter(Boolean);
    if (hits.length === 1 && hits[0].id !== fn.id) out.push(hits[0]);
  }
  return uniq(out);
}
for (const rec of recs)
  for (const fn of rec.fns) {
    fn.callees = callTargets(rec, fn);
    for (const t of fn.callees) addEdge(fn.id, t.id, 'calls');
    if (rec.tsx && /^[A-Z]/.test(fn.name)) {
      fn.body = bodyFacts(rec.lines, fn);
      const files = [rec.f.path, ...(importMap[rec.f.path] || [])];
      for (const child of fn.body.renders) {
        const hits = files.map((p) => fnByFile.get(p)?.get(child)).filter(Boolean);
        if (hits.length === 1) addEdge(fn.id, hits[0].id, 'contains');
      }
    }
  }
for (const n of nodes.values()) if (n._ts?.exported) addEdge(`file:${n.filePath}`, n.id, 'exports');

for (const rec of recs.filter((x) => /\.csproj$/.test(x.f.path))) {
  const dir = path.posix.dirname(rec.f.path);
  for (const m of rec.src.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)) addEdge(rec.id, recByPath.get(path.posix.normalize(path.posix.join(dir, m[1].replace(/\\/g, '/'))))?.id, 'depends_on');
  for (const x of recs) if (x.cs && x.f.path.startsWith(dir === '.' ? '' : dir + '/') && /(Module|Program|AssemblyInfo|DependencyInjection)\.cs$/.test(x.f.path)) addEdge(rec.id, x.id, 'configures');
}
const byBase = new Map();
for (const x of recs) byBase.set(base(x.f.path), [...(byBase.get(base(x.f.path)) || []), x]);
for (const rec of recs.filter((x) => x.type === 'document'))
  for (const m of new Set(rec.src.match(/[\w.-]+\.(?:cs|tsx?|jsx?|csproj|md)\b/g) || [])) {
    const hit = byBase.get(m);
    if (hit?.length === 1 && hit[0] !== rec) addEdge(rec.id, hit[0].id, 'documents');
  }

// --- 6. Özetler ve etiketler ---
function typeTags(t) {
  const b = t.bases.join(' ');
  const p = t.path;
  const tags = [];
  const add = (cond, ...x) => cond && tags.push(...x);
  add(/IRequestHandler</.test(b), 'handler', 'mediatr');
  add(/INotificationHandler</.test(b), 'event-handler', 'mediatr');
  add(/\bIRequest\b/.test(b) && /Command$/.test(t.name), 'command', 'mediatr');
  add(/\bIRequest\b/.test(b) && /Query$/.test(t.name), 'query', 'mediatr');
  add(/IEntityTypeConfiguration</.test(b), 'ef-configuration', 'ef-core');
  add(/DbContext/.test(b), 'dbcontext', 'ef-core');
  add(/AbstractValidator</.test(b), 'validator', 'fluentvalidation');
  add(/Event$/.test(t.name) || /\bINotification\b/.test(b), 'event');
  add(t.rec.cs.rabbit && /BackgroundService/.test(b), 'consumer', 'rabbitmq');
  add(!t.rec.cs.rabbit && /BackgroundService|IHostedService/.test(b), 'job');
  add(/Exception$/.test(t.name), 'exception');
  add(/Dto$|Response$/.test(t.name), 'dto');
  add(/Repository$/.test(t.name), t.kind === 'interface' ? 'port' : 'repository', 'repository');
  add(t.kind === 'interface' && /\/(Contracts|Ports|Abstractions)\//.test(p), 'port');
  add(/\/Domain\/|\.Domain\//.test(p) && /\/(Entities|Aggregates)\//.test(p) && t.kind !== 'enum', 'entity');
  add(/\/ValueObjects\//.test(p), 'value-object');
  add(t.rec.cs.routes.some((r) => r.line >= t.startLine && r.line <= t.endLine), 'endpoint');
  add(/CapabilityProvider$/.test(t.name), 'capability');
  add(/Service$/.test(t.name), 'service');
  add(/(Module|DependencyInjection|ServiceCollectionExtensions)$/.test(t.name) && t.mods.has('static'), 'module-registration');
  add(/Tests?$/.test(t.name), 'test');
  add(t.kind === 'enum', 'enum');
  add(t.kind === 'record', 'record');
  add(t.kind === 'interface', 'interface');
  add(t.mods.has('static'), 'static-class');
  add(!tags.length, t.kind === 'class' ? 'class' : t.kind);
  return uniq(tags).slice(0, 5);
}

function typeSummary(t) {
  if (t.doc) return t.doc;
  const find = (re) => t.bases.find((x) => re.test(x));
  const ga = (x) => genericArgs(x).map(bareType);
  const fields = (t.params || []).map((p) => p.name);
  const members = fields.length ? ` with fields ${list(fields)}` : t.props.length ? ` with properties ${list(t.props)}` : '';
  const methods = uniq((t.rec.r.functions || []).filter((f) => f.startLine >= t.startLine && f.endLine <= t.endLine && f.name !== t.name).map((f) => f.name));
  const tables = t.rec.cs.tables.filter((x) => x.line >= t.startLine && x.line <= t.endLine).map((x) => x.qualified);
  const routes = t.rec.cs.routes.filter((r) => r.line >= t.startLine && r.line <= t.endLine).map((r) => `${r.method} ${r.route}`);
  let x;
  let s;
  if ((x = find(/^IRequestHandler</))) {
    const [a, r] = ga(x);
    s = `MediatR handler for ${a}${r ? ` returning ${r}` : ''}`;
  } else if ((x = find(/^INotificationHandler</))) s = `MediatR notification handler reacting to ${ga(x)[0]}`;
  else if ((x = find(/^IEntityTypeConfiguration</))) s = `EF Core configuration mapping ${ga(x)[0]} to ${tables.length ? `table ${tables.join(', ')}` : 'its table'}`;
  else if ((x = find(/^AbstractValidator</))) s = `FluentValidation rules for ${ga(x)[0]}`;
  else if (find(/DbContext/)) s = `EF Core DbContext${t.rec.cs.defaultSchema ? ` on schema ${t.rec.cs.defaultSchema}` : ''}${t.dbSets.length ? ` exposing ${list(t.dbSets)}` : ''}`;
  else if ((x = find(/^IRequest(<|$)/))) {
    const r = ga(x)[0];
    const h = handlerOf(t);
    s = `MediatR ${/Query$/.test(t.name) ? 'query' : /Command$/.test(t.name) ? 'command' : 'request'}${r ? ` returning ${r}` : ''}${members}${h ? `; handled by ${h.name}` : ''}`;
  } else if (find(/^INotification$/) || /Event$/.test(t.name)) s = `${/Integration|Outbound|Inbound/.test(t.name + t.path) ? 'Integration' : 'Domain'} event${members}`;
  else if (find(/^(BackgroundService|IHostedService)$/)) {
    const got = uniq(t.rec.cs.deserializes.filter((d) => d.line >= t.startLine && d.line <= t.endLine).map((d) => d.name));
    s = t.rec.cs.rabbit ? `RabbitMQ consumer hosted as a background service${got.length ? `, receiving ${list(got)}` : ''}` : `Hosted background service${methods.length ? ` running ${list(methods, 4)}` : ''}`;
  } else if ((x = find(/Exception$/))) s = `Exception deriving from ${bareType(x)}${fields.length ? ` carrying ${list(fields)}` : ''}`;
  else if (t.kind === 'interface') s = `${/Repository$/.test(t.name) ? 'Repository port' : 'Interface'}${t.methods.length ? ` declaring ${list(t.methods)}` : ' with no members'}`;
  else if (t.kind === 'enum') s = t.values.length ? `Enum with values ${list(t.values, 8)}` : 'Empty enum';
  else if (routes.length) s = `Minimal API endpoints: ${list(routes, 5)}`;
  else if (t.kind === 'record') s = `${/Dto$/.test(t.name) ? 'DTO record' : 'Record'}${members || ' with no fields'}`;
  else if (t.mods.has('static') && methods.some((m) => /^(Add|Map|Use)[A-Z]/.test(m))) s = `Static registration class providing ${list(methods.filter((m) => /^(Add|Map|Use)[A-Z]/.test(m)), 4)}`;
  else {
    const entity = typeTags(t).includes('entity');
    const head = entity ? 'Domain entity' : `${t.mods.has('static') ? 'Static ' : t.mods.has('abstract') ? 'Abstract ' : ''}${t.kind}`;
    s = head + (t.bases.length ? ` deriving from ${list(t.bases.map(bareType), 3)}` : '') + (t.props.length ? `; properties ${list(t.props)}` : '') + (methods.length ? `; ${entity ? 'behaviour' : 'methods'} ${list(methods)}` : '');
    if (s === head) s = `Empty ${t.kind} with no members, used as a type marker`;
  }
  const deps = depTypes(t);
  if (deps.length) s += `; depends on ${list(deps, 4)}`;
  return sentence(s);
}

const calleeNames = (rec, fn) =>
  uniq((rec.r.callGraph || []).filter((c) => c.caller === fn.name && /^[\w.]+$/.test(c.callee)).map((c) => c.callee.split('.').pop())).filter((n) => !NOISE_CALLS.test(n) && n !== fn.name);

function fnSummary(rec, fn) {
  const doc = docAbove(rec.lines, fn.startLine);
  if (doc) return doc;
  const callees = calleeNames(rec, fn);
  const calls = callees.length ? `; calls ${list(callees, 4)}` : '';
  const params = (fn.params || []).map((p) => (p.trim().startsWith('{') ? 'props' : p.replace(/\s+/g, ' ')));
  if (rec.cs) {
    const owner = fn.owner;
    const routes = rec.cs.routes.filter((r) => r.line >= fn.startLine && r.line <= fn.endLine);
    if (routes.length) return sentence(`Maps ${list(routes.map((r) => `${r.method} ${r.route}`), 4)}`);
    const hb = owner?.bases.find((b) => /^IRequestHandler</.test(b));
    if (fn.name === 'Handle' && hb) return sentence(`Handles ${bareType(genericArgs(hb)[0])}${calls.replace(';', ':')}`);
    const tables = owner ? rec.cs.tables.filter((t) => t.line >= fn.startLine && t.line <= fn.endLine) : [];
    if (tables.length) return sentence(`Configures the EF Core mapping of ${tables[0].entity || owner.name} to table ${list(tables.map((t) => t.qualified))}`);
    const ret = returnType(rec.lines, fn);
    const what = fn.name === owner?.name ? 'Constructor' : `${owner?.mods.has('static') ? 'Static method' : 'Method'} of ${owner?.name || base(rec.f.path)}`;
    return sentence(`${what}${params.length ? ` taking (${params.join(', ')})` : ' with no parameters'}${ret ? ` returning ${ret}` : ''}${calls}`);
  }
  const bf = fn.body || bodyFacts(rec.lines, fn);
  const props = propNames(fn.params);
  const apis = rec.tsf.apis.length && /^use[A-Z]|^fetch|^(get|post|put|save|delete|create|update|download)/.test(fn.name) ? `; API ${list(rec.tsf.apis, 3)}` : '';
  if (rec.tsx && /^[A-Z]/.test(fn.name))
    return sentence(`React component ${fn.name}${props.length ? `; props ${list(props)}` : ''}${bf.hooks.length ? `; uses hooks ${list(bf.hooks, 5)}` : ''}${bf.renders.length ? `; renders ${list(bf.renders, 5)}` : ''}`);
  if (/^use[A-Z]/.test(fn.name)) {
    const rq = bf.hooks.filter((h) => /^use(Query|Queries|Mutation|InfiniteQuery|SuspenseQuery)$/.test(h));
    return sentence(`${rq.length ? 'React Query' : 'React'} hook${params.length ? ` taking (${params.join(', ')})` : ''}${bf.hooks.length ? `; uses ${list(bf.hooks, 5)}` : ''}${apis}`);
  }
  const ret = (/\)\s*:\s*([^={]+?)\s*(?:=>|\{)/.exec(rec.lines.slice(fn.startLine - 1, fn.startLine + 2).join(' ')) || [])[1];
  return sentence(`Function${params.length ? ` taking (${params.join(', ')})` : ' with no parameters'}${ret ? ` returning ${ret.trim()}` : ''}${calls}${apis}`);
}

function fnTags(rec, fn) {
  if (rec.cs) {
    const tags = [fn.owner ? 'method' : 'function'];
    if (rec.cs.routes.some((r) => r.line >= fn.startLine && r.line <= fn.endLine)) tags.push('endpoint', 'routing');
    if (fn.name === 'Handle') tags.push('handler', 'mediatr');
    if (fn.owner) tags.push(...typeTags(fn.owner).filter((t) => !['record', 'interface', 'static-class', 'class'].includes(t)).slice(0, 2));
    return uniq(tags).slice(0, 5);
  }
  if (/\.(test|spec)\./.test(rec.f.path)) return ['test', 'test-helper'];
  if (rec.tsx && /^[A-Z]/.test(fn.name)) return uniq(['component', 'react', /Page$/.test(fn.name) && 'page']);
  if (/^use[A-Z]/.test(fn.name)) return uniq(['hook', 'react', rec.tsf.apis.length && 'data-fetching']);
  return uniq(['function', rec.tsf.apis.length && 'api-client', /format|parse|map|to[A-Z]/.test(fn.name) && 'utility']);
}

function csprojSummary(src) {
  const refs = [...src.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)].map((m) => base(m[1].replace(/\\/g, '/')).replace(/\.csproj$/, ''));
  const pkgs = [...src.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]);
  const fw = [...src.matchAll(/<FrameworkReference\s+Include="([^"]+)"/g)].map((m) => m[1]);
  const sdk = (/<Project\s+Sdk="([^"]+)"/.exec(src) || [])[1];
  return `.NET project file${sdk ? ` (${sdk})` : ''}${fw.length ? `; frameworks ${fw.join(', ')}` : ''}${refs.length ? `; references ${list(refs)}` : ''}${pkgs.length ? `; packages ${list(pkgs)}` : ''}`;
}

function configSummary(rec) {
  const name = base(rec.f.path);
  if (/\.csproj$/.test(name)) return csprojSummary(rec.src);
  if (/\.json$/.test(name)) {
    let o;
    for (const text of [rec.src.replace(/^﻿/, ''), rec.src.replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1')]) {
      try {
        o = JSON.parse(text);
        break;
      } catch {}
    }
    if (o && name === 'package.json') return `npm package ${o.name || ''}; scripts ${list(Object.keys(o.scripts || {}), 5)}; dependencies ${list(Object.keys(o.dependencies || {}), 6)}`;
    if (Array.isArray(o)) return `JSON data array with ${o.length} entries${o[0] && typeof o[0] === 'object' ? ` of objects with keys ${list(Object.keys(o[0]), 5)}` : ''}`;
    if (o && typeof o === 'object') return `${/tsconfig/.test(name) ? 'TypeScript compiler configuration' : /appsettings/.test(name) ? 'Application settings' : 'JSON configuration'} with keys ${list(Object.keys(o), 6)}`;
  }
  const keys = uniq([...rec.src.matchAll(/^([A-Za-z_][\w.-]*)\s*[:=]/gm)].map((m) => m[1]));
  return keys.length ? `Configuration file with top-level keys ${list(keys, 6)}` : `Configuration file of ${rec.f.sizeLines} lines (${rec.f.language})`;
}

function tsFileSummary(rec) {
  const t = rec.tsf;
  if (t.fileDoc) return t.fileDoc;
  const p = rec.f.path;
  const exp = (rec.r.exports || []).map((e) => e.name);
  if (/\.(test|spec)\./.test(p)) return sentence(`Tests for ${base(p).replace(/\.(test|spec)\..*$/, '')}: ${t.tests} cases${t.describes.length ? ` in ${list(t.describes.map((d) => `"${d}"`), 3)}` : ''}`);
  if (/\.stories\./.test(p)) return sentence(`Storybook stories ${list(exp)}`);
  if (t.reexports.length && !rec.fns.length) return sentence(`Barrel re-exporting ${list(t.reexports)}`);
  const stem = base(p).replace(/\.\w+$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase()).toLowerCase();
  const main = rec.fns.find((f) => f.name.toLowerCase() === stem) || rec.fns.find((f) => f.exported) || rec.fns[0];
  const zod = t.zodSchemas.length ? `Zod schemas ${list(t.zodSchemas, 5)}` : '';
  if (main) {
    const others = rec.fns.filter((f) => f !== main && f.exported).map((f) => f.name);
    return sentence(`${zod ? zod + '; ' : ''}${main.node.summary.replace(/\.$/, '')}${others.length ? `. Also exports ${list(others, 5)}` : ''}`);
  }
  if (zod) return sentence(zod);
  if (t.onlyTypes) return sentence(`Type definitions ${list(exp) || 'for the feature'}`);
  return exp.length ? sentence(`Module exporting ${list(exp)}`) : sentence(`${rec.f.language} module of ${rec.f.sizeLines} lines with no exported symbols`);
}

function csFileSummary(rec) {
  const c = rec.cs;
  if (c.routes.length) return sentence(`Minimal API endpoints: ${list(c.routes.map((r) => `${r.method} ${r.route}`), 5)}`);
  const top = c.types.filter((t) => !c.types.some((o) => o !== t && o.startLine <= t.startLine && t.endLine <= o.endLine));
  const main = top.find((t) => t.name === base(rec.f.path).replace(/\.cs$/, '')) || top[0];
  if (main) {
    const others = top.filter((t) => t !== main).map((t) => t.name);
    return sentence(`${main.node.summary.replace(/\.$/, '')}${others.length ? `. Also declares ${list(others, 4)}` : ''}`);
  }
  if (c.assemblyAttrs.length) return sentence(`Assembly-level attributes: ${list(c.assemblyAttrs, 4)}`);
  if (c.globalUsings.length) return sentence(`Global using directives for ${list(c.globalUsings, 5)}`);
  if (/WebApplication\.CreateBuilder|Host\.CreateDefaultBuilder/.test(rec.src)) return 'Application entry point that builds and runs the host with top-level statements.';
  return sentence(`C# file of ${rec.f.sizeLines} lines without type declarations`);
}

function fileTags(rec) {
  const p = '/' + rec.f.path;
  const tags = [];
  if (rec.type === 'document') tags.push('documentation', /readme|claude\.md|agents\.md/i.test(p) && 'entry-point');
  if (rec.type === 'config') tags.push('configuration', /\.csproj$/.test(p) && 'build-system', /\.csproj$/.test(p) && 'dotnet-project');
  if (rec.cs) {
    const top = rec.cs.types.find((t) => t.name === base(p).replace(/\.cs$/, '')) || rec.cs.types[0];
    if (top) tags.push(...typeTags(top));
    if (rec.cs.routes.length) tags.push('endpoint', 'api-handler');
    if (/\/Migrations\//.test(p)) tags.push('migration', 'database');
    if (/(Module|Program)\.cs$/.test(p)) tags.push('entry-point');
    if (/AssemblyInfo\.cs$|AssemblyMarker\.cs$/.test(p)) tags.push('assembly-metadata');
  }
  if (rec.ts) {
    if (/\.(test|spec)\./.test(p)) tags.push('test');
    if (/\.stories\./.test(p)) tags.push('storybook');
    if (/\/index\.[jt]sx?$/.test(p)) tags.push('barrel', 'entry-point');
    if (rec.tsf.zodSchemas.length) tags.push('schema', 'zod');
    if (rec.tsf.apis.length) tags.push('api-client');
    if (rec.fns.some((f) => /^use[A-Z]/.test(f.name))) tags.push('hook');
    if (rec.tsx && rec.fns.some((f) => /^[A-Z]/.test(f.name))) tags.push(/-page\.tsx$|\/page\.tsx$/.test(p) ? 'page' : 'component');
    if (rec.tsf.onlyTypes) tags.push('type-definition');
  }
  tags.push(rec.f.language);
  return uniq(tags).slice(0, 5);
}

for (const rec of csRecs)
  for (const t of rec.cs.types) {
    t.node.summary = typeSummary(t);
    t.node.tags = typeTags(t);
  }
for (const rec of recs)
  for (const fn of rec.fns) {
    fn.node.summary = fnSummary(rec, fn);
    fn.node.tags = fnTags(rec, fn);
  }
for (const n of nodes.values())
  if (n._ts) {
    const { c } = n._ts;
    const rec = recByPath.get(n.filePath);
    n.summary = docAbove(rec.lines, c.startLine) || sentence(`Class${c.properties?.length ? ` with properties ${list(c.properties)}` : ''}${c.methods.length ? `; methods ${list(c.methods)}` : ''}`);
    n.tags = ['class', ...(n._ts.exported ? ['exported'] : [])];
    delete n._ts;
  }
for (const rec of recs) {
  const n = rec.node;
  if (rec.type === 'document') n.summary = /\.mdx?$/i.test(rec.f.path) ? markdownSummary(rec.src) : clean(rec.src.split(/\r?\n/).find((l) => l.trim()) || '');
  else if (rec.type === 'config') n.summary = sentence(configSummary(rec));
  else if (rec.cs) n.summary = csFileSummary(rec);
  else if (rec.ts) n.summary = tsFileSummary(rec);
  if (!n.summary || n.summary === n.name) n.summary = sentence(`${rec.f.language} ${rec.f.fileCategory} file of ${rec.f.sizeLines} lines`);
  n.tags = fileTags(rec);
  // Katman ve tur sınıflandırması sidecar'dan gelen model etiketlerine değil, script'in kendi etiketlerine bakar.
  rec.genTags = n.tags;
}
for (const rec of csRecs) {
  for (const r of rec.cs.routes) {
    if (!r.node) continue;
    const target = (r.requests || []).map((q) => (handlerOf(q) ? `${q.name} (handled by ${handlerOf(q).name})` : q.name));
    r.node.summary = sentence(`${r.method} ${r.route}${r.summary ? `: ${r.summary}` : ''}${target.length ? `. Sends ${list(target, 2)}` : ''}${r.auth.length ? `; requires ${list(r.auth, 2)}` : ''}`);
    r.node.tags = ['endpoint', 'minimal-api', `http-${r.method.toLowerCase()}`];
  }
  for (const t of rec.cs.tables) {
    if (!t.node) continue;
    const ent = t.ownedProp ? `owned ${t.ownedProp} of ${t.owner || 'its owner'}` : t.entity ? `entity ${t.entity}` : 'an entity';
    const cols = t.config ? uniq([...rec.cs.code.split('\n').slice(t.config.startLine - 1, t.config.endLine).join('\n').matchAll(/Property\s*\(\s*\w+\s*=>\s*\w+\.(\w+)/g)].map((m) => m[1])) : [];
    t.node.summary = sentence(`Database table ${t.qualified} mapped from ${ent}${t.config ? ` by ${t.config.name}` : ''}${cols.length ? `; configured columns ${list(cols, 8)}` : ''}`);
    t.node.tags = uniq(['database', 'table', 'ef-core', t.qualified.includes('.') && t.qualified.split('.')[0]]);
  }
}

let fromSidecar = 0;
for (const [id, s] of Object.entries(sidecar)) {
  const n = nodes.get(id);
  if (!n) continue;
  if (s.summary) n.summary = s.summary;
  if (Array.isArray(s.tags) && s.tags.length) n.tags = s.tags;
  fromSidecar++;
}

// --- 7. Katmanlar ---
const fileNodes = [...nodes.values()].filter((n) => FILE_LEVEL.has(n.type));
const edgeList = [...edges.values()].filter((e) => nodes.has(e.source) && nodes.has(e.target));
const degree = new Map();
for (const e of edgeList) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) || 0) + 1);
const rank = (ids) => [...ids].sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));

const LAYERS = {
  docs: ['Documentation', 'Documents describing the module: overviews, scope notes and references'],
  composition: ['Module Composition and Project Configuration', 'Project files, assembly metadata and the registration classes that wire the module into the host'],
  api: ['API Layer', 'HTTP surface: minimal API endpoint classes and their request bodies'],
  requests: ['Commands and Queries', 'MediatR command and query records that define the use cases'],
  handlers: ['Handlers and Validators', 'MediatR handlers and FluentValidation rules that execute the use cases'],
  events: ['Events and Consumers', 'Integration and domain events, notification handlers and message consumers'],
  contracts: ['Application Contracts', 'DTOs, repository ports and abstractions shared by handlers and infrastructure'],
  services: ['Application Services', 'Application-level services and helpers used by the handlers'],
  application: ['Application Layer', 'Commands, queries, handlers, validators, events and contracts of the use cases'],
  domain: ['Domain Model', 'Entities, aggregates, value objects, enums and domain exceptions'],
  'domain-services': ['Domain Services', 'Pure domain services and calculation engines without infrastructure dependencies'],
  persistence: ['Persistence', 'EF Core DbContext, entity configurations and repository implementations'],
  migrations: ['Schema Migrations', 'EF Core migrations that evolve the database schema'],
  infrastructure: ['Infrastructure Adapters', 'Adapters for identity, messaging, external services and background jobs'],
  tests: ['Tests, Fixtures and Stories', 'Automated tests, test fixtures and Storybook stories'],
  entry: ['Entry Points and Configuration', 'Barrel files that expose the feature to the app, plus project configuration'],
  pages: ['Pages and Routes', 'Route-level page components and app router files'],
  components: ['UI Components', 'React components that render the feature screens'],
  data: ['Data Fetching and Hooks', 'API clients, React Query hooks and other custom hooks'],
  stores: ['State Stores', 'Client-side state stores'],
  schemas: ['Schemas and Types', 'Zod schemas and TypeScript types describing payloads and view models'],
  logic: ['Domain Logic and Utilities', 'Pure functions for calculations, formatting, filtering and mapping'],
};
const APP = ['requests', 'handlers', 'events', 'contracts', 'services'];

function layerKey(rec) {
  const p = '/' + rec.f.path;
  const tags = rec.genTags;
  if (rec.type === 'document') return 'docs';
  if (/\.(test|spec|fixtures?)\.|\/__tests__\/|\/fixtures?\/|\.stories\.|[./]Tests?\//.test(p)) return 'tests';
  if (rec.cs) {
    if (/(Module|Program|AssemblyInfo|AssemblyMarker|DependencyInjection|ServiceCollectionExtensions|GlobalUsings)\.cs$/.test(p)) return 'composition';
    if (/\/Migrations\//.test(p)) return 'migrations';
    if (/[./]Api\/|\/Endpoints\/|\/Controllers\//.test(p) || rec.cs.routes.length) return 'api';
    if (/[./]Domain\//.test(p)) return /\/(Services|Engines?|Calculators?|Algorithms?|Policies|Allocation)\//.test(p) ? 'domain-services' : 'domain';
    if (/[./]Infrastructure\//.test(p)) return /\/Persistence\/|\/Configurations\/|\/Repositories\/|DbContext/.test(p) || tags.includes('ef-core') ? 'persistence' : 'infrastructure';
    if (/\/(Events?|EventHandlers|EventConsumers|Consumers|IntegrationEvents|Messaging)\//.test(p) || tags.some((t) => ['event', 'event-handler', 'consumer'].includes(t))) return 'events';
    if (tags.some((t) => ['handler', 'validator'].includes(t)) || /\/(Handlers|Validators|Behaviors)\//.test(p)) return 'handlers';
    if (tags.some((t) => ['command', 'query'].includes(t)) || /\/(Commands|Queries)\//.test(p)) return 'requests';
    if (/\/(Contracts|Dtos|DTOs|Abstractions|Ports|Interfaces|Repositories|Models)\//.test(p) || tags.some((t) => ['dto', 'port'].includes(t))) return 'contracts';
    if (/[./]Application\//.test(p)) return 'services';
    return tags.includes('entity') || tags.includes('enum') ? 'domain' : 'services';
  }
  if (rec.type === 'file' && !rec.ts) return /\/docs?\//i.test(p) ? 'docs' : 'composition';
  if (rec.type !== 'file') return rec.f.language === 'csproj' || !languages.includes('typescript') ? 'composition' : 'entry';
  if (/\/index\.[jt]sx?$/.test(p)) return 'entry';
  if (/\/app\/|\/pages\/|(-page|\/page|\/layout|\/route)\.[jt]sx?$/.test(p)) return 'pages';
  if (/\/(stores?|state)\/|-store\.[jt]s$/.test(p)) return 'stores';
  if (/\/(schemas?|types?)\/|\.(schema|types?)\.[jt]s$|\/types\.[jt]s$/.test(p) || rec.tsf?.onlyTypes) return 'schemas';
  if (/\/(api|hooks|queries|services)\/|\/use-[\w-]+\.[jt]sx?$/.test(p)) return 'data';
  if (rec.tsx || /\/components\//.test(p)) return 'components';
  return 'logic';
}

const groups = new Map();
for (const rec of recs) {
  const k = (rec.lkey = layerKey(rec));
  groups.set(k, [...(groups.get(k) || []), rec]);
}
const merge = (from, to) => {
  if (!groups.has(from) || from === to) return;
  groups.set(to, [...(groups.get(to) || []), ...groups.get(from)]);
  groups.delete(from);
};
if (APP.reduce((a, k) => a + (groups.get(k)?.length || 0), 0) < 20) for (const k of APP) merge(k, 'application');
if ((groups.get('domain-services')?.length || 0) < 8) merge('domain-services', 'domain');
if ((groups.get('infrastructure')?.length || 0) < 3 && groups.has('persistence')) merge('infrastructure', 'persistence');
const names = new Map(Object.entries(LAYERS));
// 10'dan fazla katman varsa önce anlamca yakın komşular birleşir, en son en küçük iki katman.
const NEIGHBORS = [['infrastructure', 'persistence'], ['services', 'handlers'], ['events', 'contracts'], ['domain-services', 'domain'], ['stores', 'data'], ['schemas', 'logic'], ['pages', 'components'], ['migrations', 'persistence'], ['requests', 'handlers'], ['entry', 'composition']];
for (const [from, to] of NEIGHBORS) {
  if (groups.size <= 10) break;
  if (!groups.has(from) || !groups.has(to)) continue;
  const [a, b] = [names.get(to), names.get(from)];
  names.set(to, [`${a[0]} and ${b[0]}`, `${a[1]}; ${b[1].charAt(0).toLowerCase()}${b[1].slice(1)}`]);
  merge(from, to);
}
while (groups.size > 10) {
  const [a, b] = [...groups.keys()].sort((x, y) => groups.get(x).length - groups.get(y).length);
  const key = `${a}+${b}`;
  names.set(key, [`${names.get(a)[0]} and ${names.get(b)[0]}`, `${names.get(a)[1]}; ${names.get(b)[1].charAt(0).toLowerCase()}${names.get(b)[1].slice(1)}`]);
  merge(a, key);
  merge(b, key);
}
while (groups.size < 3 && recs.length >= 3) {
  const [big] = [...groups.keys()].sort((x, y) => groups.get(y).length - groups.get(x).length);
  const byDir = new Map();
  for (const rec of groups.get(big)) {
    const d = rec.f.path.includes('/') ? rec.f.path.split('/')[0] : '(root)';
    byDir.set(d, [...(byDir.get(d) || []), rec]);
  }
  if (byDir.size < 2) break;
  groups.delete(big);
  for (const [d, rs] of byDir) {
    names.set(`${big}:${d}`, [`${names.get(big)[0]}: ${d}`, `${names.get(big)[1]} under ${d}`]);
    groups.set(`${big}:${d}`, rs);
  }
}
const ORDER = ['docs', 'composition', 'entry', 'api', 'pages', 'components', 'data', 'stores', 'requests', 'handlers', 'application', 'events', 'contracts', 'services', 'domain', 'domain-services', 'schemas', 'logic', 'persistence', 'migrations', 'infrastructure', 'tests'];
const orderOf = (k) => Math.min(...k.split(/[+:]/).map((x) => (ORDER.indexOf(x) + 1 || 99)));
const layers = [...groups.entries()]
  .sort((a, b) => orderOf(a[0]) - orderOf(b[0]))
  .map(([key, rs]) => {
    const ids = rs.flatMap((rec) => [rec.id, ...[...nodes.values()].filter((n) => (n.type === 'endpoint' || n.type === 'table') && n.filePath === rec.f.path).map((n) => n.id)]);
    const top = rank(rs.map((r) => r.id)).slice(0, 3).map((id) => nodes.get(id).name);
    const routes = ids.filter((id) => nodes.get(id).type === 'endpoint').length;
    const tables = ids.filter((id) => nodes.get(id).type === 'table').length;
    const facts = [`${rs.length} files`, routes && `${routes} HTTP routes`, tables && `${tables} tables`].filter(Boolean).join(', ');
    return { id: `layer:${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: names.get(key)[0], description: `${names.get(key)[1]} (${facts}; most connected: ${top.join(', ')}).`, nodeIds: uniq(ids), key };
  });

// --- 8. Tur ---
const firstSentence = (s) => (s.match(/^.*?[.!?](?=\s|$)/) || [s])[0];
// Tur, birleştirmeden önceki ham katman anahtarına bakar; birleşen katmanların adımları kaybolmaz.
const inKeys = (...ks) => (rec) => ks.includes(rec.lkey);
const hasTag = (...ts) => (rec) => ts.some((t) => rec.genTags.includes(t));
const LESSONS = {
  api: 'Minimal APIs map each route with a lambda and keep the endpoint thin: it binds the request and sends a MediatR message instead of holding business logic.',
  commands: 'MediatR decouples the sender from the handler: an endpoint only sends a request record, and the IRequestHandler registered for that record type runs it.',
  persistence: 'Each IEntityTypeConfiguration maps one entity to its table; the DbContext applies them all with ApplyConfigurationsFromAssembly.',
  components: 'React components receive data through props and hooks; keeping fetching in hooks lets the component stay a pure function of its inputs.',
  data: 'React Query hooks own server state: the query key identifies the cache entry and mutations invalidate keys to refetch.',
};
const STEPS = [
  { title: 'Overview', intro: 'Start with the documentation, which explains what this part of the system does and the terms used later.', pick: inKeys('docs') },
  { title: 'Module Wiring', intro: 'These registration classes show how the module plugs into the host: services, handlers, the DbContext and the endpoint map.', pick: (r) => inKeys('composition')(r) && /(Module|Program|DependencyInjection|ServiceCollectionExtensions).cs$/.test(r.f.path) },
  { title: 'Feature Entry Points', intro: 'Barrel files define what the rest of the app can import from this feature.', pick: (r) => inKeys('entry')(r) && r.ts },
  { title: 'The HTTP Surface', intro: 'The API layer maps HTTP routes to MediatR requests.', pick: (r) => inKeys('api')(r) && r.cs?.routes.length, lesson: LESSONS.api },
  { title: 'Pages and Routes', intro: 'Route-level pages are where a user enters the feature.', pick: inKeys('pages') },
  { title: 'Domain Model', intro: 'The domain model holds the entities and rules every use case works on.', pick: inKeys('domain') },
  { title: 'Domain Services', intro: 'Domain services hold the pure calculations used by the handlers.', pick: inKeys('domain-services') },
  { title: 'Commands and Their Handlers', intro: 'Commands change state; each is executed by exactly one handler.', pick: hasTag('command'), pair: true, lesson: LESSONS.commands },
  { title: 'Queries and Read Models', intro: 'Queries read data and return DTOs without changing state.', pick: hasTag('query'), pair: true },
  { title: 'Other Handlers and Validators', intro: 'Handlers and validators that run the remaining use cases.', pick: inKeys('handlers') },
  { title: 'Events and Consumers', intro: 'Events carry state changes across module boundaries; consumers react to them.', pick: inKeys('events') },
  { title: 'Application Contracts', intro: 'Ports and DTOs decouple the handlers from persistence and other modules.', pick: inKeys('contracts') },
  { title: 'Application Services', intro: 'Application services orchestrate work shared by several handlers.', pick: inKeys('services') },
  { title: 'UI Components', intro: 'Components render the screens and compose smaller building blocks.', pick: inKeys('components'), lesson: LESSONS.components },
  { title: 'Data Fetching and Hooks', intro: 'Hooks and API clients load and mutate server data for the components.', pick: inKeys('data'), lesson: LESSONS.data },
  { title: 'State Stores', intro: 'Stores keep client-side state shared across components.', pick: inKeys('stores') },
  { title: 'Schemas and Types', intro: 'Schemas validate API payloads and define the types the UI works with.', pick: inKeys('schemas') },
  { title: 'Domain Logic and Utilities', intro: 'Pure functions hold the calculations and formatting rules of the feature.', pick: inKeys('logic') },
  { title: 'Persistence', intro: 'Persistence maps the domain to database tables and implements the repository ports.', pick: inKeys('persistence'), lesson: LESSONS.persistence },
  { title: 'Schema Migrations', intro: 'Migrations record how the database schema evolved.', pick: inKeys('migrations') },
  { title: 'Infrastructure Adapters', intro: 'Adapters connect the module to identity, messaging and external services.', pick: inKeys('infrastructure') },
  { title: 'Project Configuration', intro: 'Project files define dependencies between the layers and external packages.', pick: (r) => r.type === 'config' },
];
const used = new Set();
const candidates = (step) => rank(recs.filter((r) => step.pick(r) && !used.has(r.id)).map((r) => r.id));
function makeStep(step, ids, title = step.title) {
  ids.forEach((id) => used.add(id));
  const parts = ids.map((id) => `${nodes.get(id).name}: ${firstSentence(nodes.get(id).summary)}`);
  let description = `${step.intro} ${parts.join(' ')}`;
  if (description.length > 900) description = description.slice(0, 900).replace(/\s+\S*$/, '') + '…';
  return { title, description, nodeIds: ids, ...(step.lesson ? { languageLesson: step.lesson } : {}) };
}
function pickIds(step) {
  const c = candidates(step);
  if (!step.pair) return c.slice(0, 5);
  const out = [];
  for (const id of c) {
    if (out.length >= 5) break;
    out.push(id);
    const req = recByPath.get(nodes.get(id).filePath).cs?.types.find((t) => handlerOf(t));
    const h = req && handlerOf(req);
    if (h && out.length < 5 && !used.has(h.rec.id)) out.push(h.rec.id);
  }
  return uniq(out).slice(0, 5);
}
let tour = [];
for (const step of STEPS) {
  const ids = pickIds(step);
  if (ids.length) tour.push({ ...makeStep(step, ids), step });
}
// 8 adımdan azsa en kalabalık alanın sıradaki düğümleri ek adım olur.
while (tour.length < 8) {
  const best = tour.map((t, i) => ({ i, step: t.step, rest: candidates(t.step) })).sort((a, b) => b.rest.length - a.rest.length)[0];
  if (!best || !best.rest.length) break;
  const ids = best.rest.slice(0, 5);
  const same = tour.filter((t) => t.step === best.step).length;
  const at = tour.findLastIndex((t) => t.step === best.step);
  tour.splice(at + 1, 0, { ...makeStep(best.step, ids, `${best.step.title}, part ${same + 1}`), step: best.step });
}
tour = tour.slice(0, 15).map(({ step, ...s }, i) => ({ order: i + 1, ...s }));

// --- 9. Doğrula ve kaydet ---
const graph = { nodes: [...nodes.values()], edges: edgeList, layers: layers.map(({ key, ...l }) => l), tour };
const { issues, warnings } = dogrula(graph);
if (issues.length) {
  console.error(`Doğrulama başarısız (${issues.length} sorun):\n${issues.slice(0, 30).join('\n')}`);
  process.exit(1);
}
const entry = kaydet(P.root, scanResult, graph, { generator: 'script' });
const count = (a, k) => a.reduce((o, x) => ((o[x[k]] = (o[x[k]] || 0) + 1), o), {});
console.log(
  JSON.stringify(
    {
      graph: entry.graph,
      files: scan.totalFiles,
      nodes: graph.nodes.length,
      nodeTypes: count(graph.nodes, 'type'),
      edges: graph.edges.length,
      edgeTypes: count(graph.edges, 'type'),
      droppedEdges: edges.size - edgeList.length,
      layers: entry.layers,
      tourSteps: tour.length,
      orphanWarnings: warnings.length,
      sidecar: { harvested, applied: fromSidecar },
      seconds: +((Date.now() - started) / 1000).toFixed(1),
    },
    null,
    1,
  ),
);
