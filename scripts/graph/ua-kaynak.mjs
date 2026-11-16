// Kaynak dosyalardan model çağırmadan çıkarılan gerçekler: C# tipleri, rotalar, tablolar, MediatR akışı,
// TS bileşen/hook bilgisi, doc comment ve markdown özetleri.

export const lineStarts = (src) => {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') out.push(i + 1);
  return out;
};
export const lineAt = (starts, pos) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

// Yorum ve string içeriğini boşlukla değiştirir; uzunluk ve satırlar korunur, böylece konumlar iki metinde aynıdır.
export function maskCsharp(src) {
  const code = src.split('');
  const nc = src.split('');
  const blank = (arr, a, b) => {
    for (let k = a; k < b && k < arr.length; k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      blank(code, i, j);
      blank(nc, i, j);
      i = j;
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(code, i, j);
      blank(nc, i, j);
      i = j;
    } else if (c === "'") {
      const m = /^'(?:[^'\\\n]|\\[^\n]{1,9}?)'/.exec(src.slice(i, i + 12));
      if (m) blank(code, i + 1, i + m[0].length - 1);
      i += m ? m[0].length : 1;
    } else if (c === '"' || ((c === '$' || c === '@') && (d === '"' || ((d === '$' || d === '@') && src[i + 2] === '"')))) {
      let j = i;
      let verbatim = false;
      while (src[j] !== '"') if (src[j++] === '@') verbatim = true;
      let q = 0;
      while (src[j + q] === '"') q++;
      if (q >= 3) {
        const end = src.indexOf('"'.repeat(q), j + q);
        const e = end < 0 ? n : end;
        blank(code, j + q, e);
        i = e + q;
        continue;
      }
      if (q === 2) {
        i = j + 2;
        continue;
      }
      let k = j + 1;
      if (verbatim) {
        while (k < n && !(src[k] === '"' && src[k + 1] !== '"')) k += src[k] === '"' ? 2 : 1;
      } else {
        while (k < n && src[k] !== '"' && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      }
      blank(code, j + 1, k);
      i = k + 1;
    } else i++;
  }
  return { code: code.join(''), noComments: nc.join('') };
}

const PAIRS = { '(': ')', '{': '}', '[': ']', '<': '>' };
export function matchClose(code, open) {
  const o = code[open];
  const c = PAIRS[o];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++;
    else if (code[i] === c && --depth === 0) return i;
    else if (o === '<' && (code[i] === '{' || code[i] === ';')) return -1;
  }
  return -1;
}

export function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('(<[{'.includes(ch)) depth++;
    else if (')>]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function parseParams(s) {
  return splitTop(s.replace(/\[[^\]]*\]/g, ' '))
    .map((p) => p.replace(/=.*$/s, '').replace(/\b(this|params|ref|out|in|scoped|readonly)\s+/g, '').trim())
    .map((p) => {
      const m = /^(.*?)\s*\b(@?\w+)$/s.exec(p);
      return m && m[1] ? { type: m[1].replace(/\s+/g, ' ').trim(), name: m[2] } : null;
    })
    .filter(Boolean);
}

export const typeNames = (s) => [...new Set((s || '').match(/\b[A-Z]\w*\b/g) || [])];
export const genericArgs = (s) => {
  const i = (s || '').indexOf('<');
  return i < 0 ? [] : splitTop(s.slice(i + 1, s.lastIndexOf('>')));
};
export const bareType = (s) => (s || '').replace(/<.*$/s, '').replace(/[?[\]]/g, '').split('.').pop().trim();

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function clean(text, max = 320) {
  let t = (text || '')
    .replace(/<see(?:also)?\s+(?:cref|href|langword)="(?:\w:)?([^"]+)"\s*\/>/g, (_, x) => x.replace(/\{.*\}|\(.*\)/g, '').split('.').pop())
    .replace(/<(?:paramref|typeparamref)\s+name="([^"]+)"\s*\/>/g, '$1')
    .replace(/<\/?(?:c|b|i|em|code|strong)>/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, x) => ENTITIES[x])
    .replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[;,]\./g, '.')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > max * 0.4 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

// Bildirimin hemen üstündeki doc comment: önce ///, sonra /** */, yoksa // blok.
export function docAbove(lines, startLine) {
  let i = startLine - 2;
  while (i >= 0 && /^\s*(\[|@\w)/.test(lines[i]) && !/^\s*\/\//.test(lines[i])) i--;
  const xml = [];
  while (i >= 0 && /^\s*\/\/\//.test(lines[i])) xml.unshift(lines[i--].replace(/^\s*\/\/\/\s?/, ''));
  if (xml.length) {
    const s = xml.join('\n');
    const m = /<summary>([\s\S]*?)<\/summary>/.exec(s);
    return clean(m ? m[1] : s.replace(/<(param|returns|remarks|typeparam|exception)\b[\s\S]*$/, ''));
  }
  if (i >= 0 && /\*\/\s*$/.test(lines[i])) {
    const block = [];
    while (i >= 0) {
      block.unshift(lines[i]);
      if (/^\s*\/\*/.test(lines[i--])) break;
    }
    const text = block
      .join('\n')
      .replace(/^\s*\/\*\*?|\*\/\s*$/g, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .replace(/^\s*@[\s\S]*$/m, '');
    return clean(text);
  }
  const plain = [];
  while (i >= 0 && /^\s*\/\/(?!\/)/.test(lines[i])) plain.unshift(lines[i--].replace(/^\s*\/\/\s?/, ''));
  const t = plain.join(' ');
  return /^(eslint|@ts-|prettier|ponytail:|TODO)/i.test(t.trim()) ? '' : clean(t);
}

const TYPE_RE = /(^|[\s;{}\]])((?:(?:public|internal|private|protected|static|sealed|abstract|partial|readonly|file|unsafe|new|ref)\s+)*)(class|struct|interface|enum|record(?:\s+class|\s+struct)?)\s+([A-Za-z_]\w*)/g;

function skipWs(code, p) {
  while (p < code.length && /\s/.test(code[p])) p++;
  return p;
}

function parseType(code, m, starts) {
  const kind = m[3].startsWith('record') ? 'record' : m[3];
  const start = m.index + m[1].length;
  let p = skipWs(code, m.index + m[0].length);
  if (code[p] === '<') {
    const e = matchClose(code, p);
    if (e > 0) p = skipWs(code, e + 1);
  }
  let params = null;
  if (code[p] === '(') {
    const e = matchClose(code, p);
    if (e < 0) return null;
    params = parseParams(code.slice(p + 1, e));
    p = skipWs(code, e + 1);
  }
  let bases = [];
  // "record with {" gibi ifadeler tip bildirimi değildir.
  if (!':{;'.includes(code[p]) && !code.startsWith('where', p)) return null;
  if (code[p] === ':') {
    let q = p + 1;
    let depth = 0;
    while (q < code.length && !(depth === 0 && (code[q] === '{' || code[q] === ';'))) {
      if ('(<'.includes(code[q])) depth++;
      else if (')>'.includes(code[q])) depth--;
      q++;
    }
    bases = splitTop(code.slice(p + 1, q).split(/\bwhere\b/)[0]).map((b) => b.replace(/\(.*$/s, '').trim());
    p = q;
  }
  while (p < code.length && code[p] !== '{' && code[p] !== ';') p++;
  const end = code[p] === '{' ? matchClose(code, p) : p;
  if (end < 0) return null;
  return {
    name: m[4],
    kind,
    mods: new Set(m[2].trim().split(/\s+/).filter(Boolean)),
    params,
    bases,
    start,
    bodyStart: code[p] === '{' ? p : -1,
    end,
    startLine: lineAt(starts, start),
    endLine: lineAt(starts, end),
  };
}

const stringAt = (code, noComments, quote) => {
  const close = code.indexOf('"', quote + 1);
  return close < 0 ? null : noComments.slice(quote + 1, close);
};

// Rota argümanı: "literal", $"{Sabit}/x" ya da Sabit.
function routeArg(text, consts) {
  const m = /^\s*(\$?@?)"((?:[^"\\\n]|\\.)*)"|^\s*(\w+)\s*[,)]/.exec(text);
  if (!m) return null;
  if (m[3]) return consts.get(m[3]) ?? null;
  let s = m[2];
  if (m[1].includes('$')) {
    let ok = true;
    s = s.replace(/\{\{/g, '\u0001').replace(/\}\}/g, '\u0002').replace(/\{(\w+)\}/g, (_, k) => (consts.has(k) ? consts.get(k) : ((ok = false), '')));
    if (!ok || /[{}]/.test(s)) return null;
    s = s.replace(/\u0001/g, '{').replace(/\u0002/g, '}');
  }
  return s;
}

const joinRoute = (prefix, route) => {
  if (!prefix) return route || '/';
  if (!route || route === '/') return prefix;
  return prefix.replace(/\/$/, '') + '/' + route.replace(/^\//, '');
};

export function csharpFacts(src) {
  const { code, noComments } = maskCsharp(src);
  const starts = lineStarts(src);
  const lines = src.split(/\r?\n/);
  const ns = (code.match(/^\s*namespace\s+([\w.]+)/m) || [])[1] || '';
  const usings = [...code.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/gm)].map((m) => m[1]);
  const globalUsings = [...code.matchAll(/^\s*global\s+using\s+(?:static\s+)?([\w.]+)\s*;/gm)].map((m) => m[1]);
  const consts = new Map(
    [...noComments.matchAll(/\bconst\s+string\s+(\w+)\s*=\s*"((?:[^"\\\n]|\\.)*)"\s*;/g)].map((m) => [m[1], m[2]]),
  );

  const types = [];
  for (const m of code.matchAll(TYPE_RE)) {
    const t = parseType(code, m, starts);
    if (!t || types.some((x) => x.name === t.name)) continue;
    t.doc = docAbove(lines, t.startLine);
    const body = t.bodyStart >= 0 ? code.slice(t.bodyStart + 1, t.end) : '';
    if (t.kind === 'enum') t.values = splitTop(body).map((v) => (v.match(/^[A-Za-z_]\w*/) || [''])[0]).filter(Boolean);
    if (t.kind === 'interface') t.methods = [...new Set([...body.matchAll(/(\w+)\s*(?:<[^>()]*>)?\s*\([^;{}]*\)\s*;/g)].map((x) => x[1]))];
    t.ctorParams = [];
    for (const c of body.matchAll(new RegExp(`\\b(?:public|internal|protected|private)\\s+${t.name}\\s*\\(`, 'g'))) {
      const open = t.bodyStart + 1 + c.index + c[0].length - 1;
      const close = matchClose(code, open);
      if (close > 0) t.ctorParams.push(...parseParams(code.slice(open + 1, close)));
    }
    t.dbSets = [...body.matchAll(/DbSet<(\w+)>\s+(\w+)/g)].map((x) => x[1]);
    t.props = [...body.matchAll(/\bpublic\s+(?:required\s+|virtual\s+|override\s+|static\s+)*[\w<>[\],.?\s]+?\s+(\w+)\s*\{\s*(?:get|init|set)/g)].map((x) => x[1]);
    types.push(t);
  }

  const groups = new Map();
  for (const m of code.matchAll(/(\w+)\s*=\s*([\w.]+?)\s*\.\s*MapGroup\s*\(/g)) {
    const arg = routeArg(noComments.slice(m.index + m[0].length), consts);
    if (arg !== null) groups.set(m[1], joinRoute(groups.get(m[2].split('.')[0]) || '', arg));
  }
  const routes = [];
  for (const m of code.matchAll(/(\w+)\s*\.\s*Map(Get|Post|Put|Delete|Patch)\s*(?:<[^>()]*>)?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open);
    const arg = routeArg(noComments.slice(open + 1), consts);
    if (arg === null || close < 0) continue;
    // Zincirdeki .WithSummary/.RequireAuthorization çağrıları Map(...)'in kapanışından sonraki ifadede.
    let stmtEnd = code.indexOf(';', close);
    if (stmtEnd < 0) stmtEnd = code.length;
    const tail = noComments.slice(close, stmtEnd);
    const handlerName = (/,\s*([A-Z]\w*)\s*\)\s*$/.exec(code.slice(open, close + 1)) || [])[1];
    routes.push({
      method: m[2].toUpperCase(),
      route: joinRoute(groups.get(m[1]) || '', arg),
      pos: m.index,
      line: lineAt(starts, m.index),
      span: code.slice(open, close + 1),
      handlerName,
      summary: (/\.WithSummary\(\s*"([^"]*)"/.exec(tail) || [])[1] || '',
      auth: [...tail.matchAll(/\.Require\w*\(\s*"([^"]+)"/g)].map((x) => x[1]),
    });
  }

  const defaultSchema = (/HasDefaultSchema\(\s*"([^"]+)"/.exec(noComments) || [])[1] || '';
  const tables = [];
  for (const m of code.matchAll(/\bToTable\s*\(\s*"/g)) {
    const q = m.index + m[0].length - 1;
    const name = stringAt(code, noComments, q);
    const after = noComments.slice(code.indexOf('"', q + 1) + 1, code.indexOf('"', q + 1) + 120);
    const schema = (/^\s*,\s*(?:schema\s*:\s*)?"([^"]+)"/.exec(after) || [])[1] || '';
    const before = code.slice(Math.max(0, m.index - 3000), m.index);
    const ent = [...before.matchAll(/(?:IEntityTypeConfiguration|Entity|EntityTypeBuilder)\s*<\s*([\w.]+)\s*>/g)].pop();
    const owned = [...before.matchAll(/Owns(?:Many|One)\s*(?:<\s*([\w.]+)\s*>)?\s*\(\s*(?:"(\w+)"|\w+\s*=>\s*\w+\.(\w+))/g)].pop();
    const isOwned = owned && (!ent || owned.index > ent.index);
    if (name)
      tables.push({
        name,
        schema,
        entity: isOwned ? (owned[1] ? bareType(owned[1]) : '') : ent ? bareType(ent[1]) : '',
        owner: isOwned && ent ? bareType(ent[1]) : '',
        ownedProp: isOwned ? owned[2] || owned[3] : '',
        line: lineAt(starts, m.index),
      });
  }

  const migrationTables = [];
  for (const m of code.matchAll(/migrationBuilder\s*\.\s*(\w+)\s*(?:<[^>()]*>)?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open);
    if (close < 0) continue;
    const args = Object.fromEntries([...noComments.slice(open, close).matchAll(/\b(\w+)\s*:\s*"([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const table = args.table || (/Table$/.test(m[1]) ? args.name : null);
    if (table) migrationTables.push({ name: table, schema: args.schema || '', op: m[1] });
  }

  const at = (re, group = 1) => [...code.matchAll(re)].map((m) => ({ name: bareType(m[group]), qual: m[group], pos: m.index, line: lineAt(starts, m.index) }));
  return {
    ns,
    usings,
    globalUsings,
    types,
    routes,
    tables,
    defaultSchema,
    migrationTables,
    sends: at(/\bSend(?:Async)?\s*(?:<[^>()]*>)?\s*\(\s*new\s+([\w.]+)/g),
    publishes: [
      ...at(/\bPublish(?:Async)?\s*(?:<[^>()]*>)?\s*\(\s*new\s+([\w.]+)/g),
      ...at(/\w*[oO]utbox\w*\s*\.\s*\w+Async\s*\(\s*new\s+([\w.]+)/g),
    ],
    deserializes: at(/\bDeserialize(?:Async)?\s*<\s*([\w.]+)\s*>/g),
    rabbit: /\busing\s+RabbitMQ\b/.test(code),
    assemblyAttrs: [...noComments.matchAll(/\[\s*assembly\s*:\s*(\w+)(?:\(\s*"([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1])),
    lines,
    code,
  };
}

// Bildirim satırından dönüş tipi: modifier'lar atılır, addan önceki son tip kalır.
export function returnType(lines, fn) {
  const text = lines.slice(fn.startLine - 1, fn.startLine + 2).join(' ');
  const m = new RegExp(`([\\w<>\\[\\],.?\\s]+?)\\s+${fn.name}\\s*(?:<[^>()]*>)?\\s*\\(`).exec(text);
  if (!m) return '';
  const t = m[1]
    .replace(/\b(public|private|protected|internal|static|async|override|virtual|sealed|abstract|new|extern|unsafe|partial|readonly|export|function|default)\b/g, '')
    .trim();
  return /^(void|Task|ValueTask)$/.test(t) || !/^[\w<>[\],.?\s]+$/.test(t) ? '' : t.replace(/^(Task|ValueTask)<(.*)>$/, '$2');
}

export function tsFacts(src) {
  const lines = src.split(/\r?\n/);
  const consts = new Map([...src.matchAll(/\bconst\s+(\w+)\s*=\s*["'`](\/api\/[^"'`$]*)["'`]/g)].map((m) => [m[1], m[2]]));
  const apis = new Set();
  for (const m of src.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)) apis.add(m[1].replace(/\$\{[^}]*\}/g, '{…}').replace(/\?.*$/, ''));
  for (const m of src.matchAll(/`\$\{(\w+)\}([^`]*)`/g)) if (consts.has(m[1])) apis.add((consts.get(m[1]) + m[2]).replace(/\$\{[^}]*\}/g, '{…}').replace(/\?.*$/, ''));
  const head = /^\s*(?:["']use (?:client|server)["'];?\s*)?(\/\*[\s\S]*?\*\/|(?:\s*\/\/[^\n]*\n)+)/.exec(src);
  const fileDoc = head ? clean(head[1].replace(/^\s*\/\*\*?|\*\/\s*$/g, '').replace(/^\s*(\*|\/\/)\s?/gm, '')) : '';
  return {
    lines,
    apis: [...apis],
    fileDoc: /^(eslint|@ts-|prettier)/i.test(fileDoc) ? '' : fileDoc,
    zodSchemas: [...src.matchAll(/export\s+const\s+(\w+)\s*=\s*z\s*\./g)].map((m) => m[1]),
    reexports: [...src.matchAll(/export\s+(?:\*|\{([^}]*)\})\s+from\s+["']([^"']+)["']/g)].flatMap((m) =>
      m[1] ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, '')).filter(Boolean) : [`* from ${m[2]}`],
    ),
    tests: (src.match(/\b(?:it|test)(?:\.each\([^)]*\))?\s*\(\s*["'`]/g) || []).length,
    describes: [...src.matchAll(/\bdescribe\s*\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]),
    onlyTypes: !/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|let)\b/.test(src) && /export\s+(?:type|interface)\b/.test(src),
  };
}

// Bileşen/hook gövdesindeki gerçekler: kullanılan hook'lar ve render edilen bileşenler.
export function bodyFacts(lines, fn) {
  const body = lines.slice(fn.startLine - 1, fn.endLine).join('\n');
  return {
    hooks: [...new Set([...body.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]))].filter((h) => h !== fn.name),
    renders: [...new Set([...body.matchAll(/<([A-Z]\w*)[\s/>]/g)].map((m) => m[1]))].filter((c) => c !== fn.name),
  };
}

export const propNames = (params) => {
  const first = (params || [])[0] || '';
  const m = /^\s*\{([\s\S]*)\}/.exec(first);
  return m ? splitTop(m[1]).map((p) => p.split(/[=:]/)[0].replace(/^\.\.\./, '').trim()).filter((p) => /^\w+$/.test(p)) : [];
};

export function markdownSummary(src) {
  const lines = src.replace(/^---[\s\S]*?\n---\s*\n/, '').split(/\r?\n/);
  const heading = (lines.find((l) => /^#{1,3}\s+\S/.test(l)) || '').replace(/^#+\s*/, '');
  const para = [];
  let inFence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) inFence = !inFence;
    if (inFence || /^\s*(#|```|\||<|!\[|---)/.test(l)) {
      if (para.length) break;
      continue;
    }
    if (!l.trim()) {
      if (para.length) break;
      continue;
    }
    para.push(l.trim());
  }
  const strip = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
  const text = [heading && strip(heading).replace(/[.:]?$/, '.'), strip(para.join(' '))].filter(Boolean).join(' ');
  return clean(text, 360);
}
