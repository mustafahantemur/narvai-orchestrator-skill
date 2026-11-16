import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, matchesGlob, relative } from 'node:path';
import { git, repoRoot } from './ortak.mjs';
import { changedFiles, ignored, profiles } from './verify.mjs';

const any = (f, globs = []) => globs.some((g) => matchesGlob(f, g));
const isTest = (f, p) => any(f, p.tests?.paths);
const isSource = (f, p) => any(f, p.source) && !isTest(f, p) && !ignored(f, p.ignore);

export function pairTargets(file, pairs = []) {
  return pairs.flatMap(({ from, to }) => {
    const m = new RegExp(from).exec(file);
    return m ? [to.replace(/\$\{(\w+)\}/g, (_, k) => m.groups?.[k] ?? '')] : [];
  });
}

const endsAs = (file, target) => file === target || file.endsWith(`/${target}`);

// Type or component names declared in the file; the one named like the file wins.
export function declaredNames(file, text) {
  const decl = /^[ \t]*(?:[a-z]+\s+)*?(?:class|record|struct|interface|enum|function|const|type)\s+([A-Z]\w*?[a-z]\w*)(?=\s*[=(<:{]|\s+(?:extends|implements)\b|\s*$)/gm;
  const names = [...new Set([...text.matchAll(decl)].map((m) => m[1]))];
  const own = basename(file, extname(file)).replace(/[-_.]/g, '').toLowerCase();
  const exact = names.filter((n) => n.toLowerCase() === own);
  const near = names.filter((n) => n.toLowerCase().includes(own));
  return exact.length ? exact : near.length ? near.slice(0, 3) : names.filter((n) => n.length >= 8).slice(0, 3);
}

export function testsFor(src, { profile, testFiles, read }) {
  const found = new Set();
  for (const t of pairTargets(src, profile.tests?.pairs)) for (const f of testFiles) if (endsAs(f, t)) found.add(f);
  const names = declaredNames(src, read(src) ?? '');
  if (names.length) {
    const word = new RegExp(`\\b(${names.join('|')})\\b`);
    for (const f of testFiles) if (!found.has(f) && word.test(read(f) ?? '')) found.add(f);
  }
  return [...found];
}

export function untouched({ changed, files, profiles: ps, read }) {
  const touched = new Set(changed);
  const rows = [];
  let sources = 0, noTest = 0;
  for (const profile of ps) {
    const testFiles = files.filter((f) => isTest(f, profile) && any(f, profile.source));
    for (const src of changed.filter((f) => isSource(f, profile))) {
      sources++;
      const tests = testsFor(src, { profile, testFiles, read });
      if (!tests.length) noTest++;
      else if (!tests.some((t) => touched.has(t))) rows.push({ src, tests });
    }
  }
  return { sources, noTest, rows };
}

function last(repo, file) {
  const [date, hash, subject] = git(['log', '-1', '--format=%cI%x09%h%x09%s', '--', file], repo).split('\t');
  const dirty = git(['status', '--porcelain', '--', file], repo) ? '  (uncommitted changes)' : '';
  return { date, text: date ? `${date.slice(0, 10)} ${hash} ${subject.slice(0, 70).trimEnd()}${dirty}` : `no commit${dirty}` };
}

function failedReport(repo, failing, ps, files) {
  const outLines = [];
  for (const raw of failing) {
    const test = (isAbsolute(raw) ? relative(repo, raw) : raw).replace(/\\/g, '/');
    const sources = ps.flatMap((p) => files.filter((f) => isSource(f, p) && pairTargets(f, p.tests?.pairs).some((t) => endsAs(test, t))));
    const t = last(repo, test);
    outLines.push(`failing ${test}`, `  test    ${t.text}`);
    if (!sources.length) { outLines.push('  source  none found (no tests.pairs rule maps a source file to this test)'); continue; }
    for (const s of sources.slice(0, 2)) {
      const c = last(repo, s);
      outLines.push(`  source  ${s}  ${c.text}`);
      const d = Date.parse(c.date) - Date.parse(t.date);
      outLines.push(`  newer   ${Number.isNaN(d) ? 'unknown' : d > 0 ? 'source' : d < 0 ? 'test' : 'same commit time'}`);
    }
  }
  return outLines;
}

export default async function run(args) {
  const repo = repoRoot();
  if (!repo) throw new Error('not inside a git repository');
  const ps = profiles(repo);
  if (!ps.length) throw new Error('no profile matches this repo: add profiles/<stack>');
  const at = args.indexOf('--base');
  const { base, files: changed } = changedFiles(repo, at >= 0 ? args[at + 1] : undefined);
  const files = [...new Set([...git(['ls-files'], repo).split('\n'), ...changed])].filter(Boolean);
  const cache = new Map();
  const read = (f) => {
    if (!cache.has(f)) { const p = join(repo, f); cache.set(f, existsSync(p) ? readFileSync(p, 'utf8') : null); }
    return cache.get(f);
  };
  const { sources, noTest, rows } = untouched({ changed, files, profiles: ps, read });
  const result = [`narvai tests: ${sources} changed source file(s) vs ${base}; ${rows.length} with tests not touched in this diff, ${noTest} with no test found`];
  for (const r of rows) result.push(`  ${r.src} -> ${r.tests[0]}${r.tests.length > 1 ? ` (+${r.tests.length - 1})` : ''}`);
  const fi = args.indexOf('--failed');
  if (fi >= 0) {
    const end = args.findIndex((a, i) => i > fi && a.startsWith('--'));
    result.push(...failedReport(repo, args.slice(fi + 1, end < 0 ? undefined : end), ps, files));
  }
  const max = 30;
  console.log((result.length > max ? [...result.slice(0, max - 1), `  ... ${result.length - max + 1} more lines`] : result).join('\n'));
}
