import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, matchesGlob } from 'node:path';
import { detectStacks, git, HARNESS, readJson, repoRoot, storeFor } from './ortak.mjs';

const lines = (s) => s.split('\n').filter(Boolean);

export function changedFiles(repo, base) {
  if (!base) {
    const upstream = git(['rev-parse', '--abbrev-ref', '@{u}'], repo);
    base = upstream || ['origin/development', 'origin/main', 'origin/master'].find((b) => git(['rev-parse', '--verify', '-q', b], repo));
  }
  const files = new Set([
    ...(base ? lines(git(['diff', '--name-only', `${base}...HEAD`], repo)) : []),
    ...lines(git(['diff', '--name-only', 'HEAD'], repo)),
    ...lines(git(['ls-files', '--others', '--exclude-standard'], repo)),
  ]);
  return { base: base ?? '(none)', files: [...files] };
}

export const profiles = (repo, dir = join(HARNESS, 'profiles')) =>
  detectStacks(repo, dir).map((s) => readJson(join(dir, s, 'profile.json'), null)).filter(Boolean);

export const ignored = (f, globs = []) => globs.some((g) => matchesGlob(f, g.endsWith('/') ? `${g}**` : g));

function scriptRunner(repo) {
  const scripts = readJson(join(repo, 'package.json'), {}).scripts ?? {};
  const pm = existsSync(join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(repo, 'yarn.lock')) ? 'yarn' : 'npm run';
  return (names = []) => names.filter((s) => scripts[s]).map((s) => `${pm} ${s}`)[0];
}

const ERROR = [
  /\berror\s+[A-Z]+\d+\b/,
  /\s-\s+error\s+TS\d+/,
  /^\s*\d+:\d+\s+error\s/,
  /^\s*failed\s+\S/i,
  /\bAssert\.\w+\(\) Failure/,
  /^\s*(Expected|Actual|Received):/,
  /^\s*(FAIL|×|✗|❯)\s/,
  /\b\w*(Error|Exception):/,
  /\b\d+ failed\b/,
];

export function errorLines(log, max = 36, root = '') {
  let text = log.replace(/\x1b\[[0-9;]*m/g, '');
  if (root) for (const r of [root.replace(/\\/g, '/'), root.replace(/\//g, '\\')]) text = text.split(`${r}/`).join('').split(`${r}\\`).join('');
  const all = text.split(/\r?\n/);
  const seen = new Set();
  const hits = [];
  let header = null;
  for (const l of all) {
    if (/^\S.*\.\w+$/.test(l)) header = l;
    if (!ERROR.some((r) => r.test(l))) continue;
    // ESLint prints the file once, above its indented error lines.
    if (/^\s+\d+:\d+/.test(l) && header && !seen.has(header)) { seen.add(header); hits.push(header); }
    const key = l.trim();
    if (!seen.has(key)) { seen.add(key); hits.push(l.trimEnd()); }
  }
  const picked = hits.length ? hits : all.map((l) => l.trimEnd()).filter(Boolean).slice(-15);
  return { lines: picked.slice(0, max), more: Math.max(0, picked.length - max) };
}

function runCheck(name, cmd, repo) {
  const t0 = Date.now();
  const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
  try {
    execSync(cmd, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    console.log(`  PASS     ${name}  ${secs()}`);
    return true;
  } catch (e) {
    const log = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    const file = join(tmpdir(), `narvai-verify-${name.replace(/\W+/g, '_')}-${Date.now()}.log`);
    writeFileSync(file, `$ ${cmd}\n${log}`);
    const { lines: found, more } = errorLines(log, 36, repo);
    console.log(`  FAIL     ${name}  ${secs()}  (${cmd})`);
    for (const l of found) console.log(`           ${l}`);
    console.log(`           ${more ? `+${more} more error lines; ` : ''}full log: ${file}`);
    return false;
  }
}

export default async function run(args) {
  const repo = repoRoot();
  if (!repo) throw new Error('not inside a git repository');
  let store = null;
  try { store = storeFor(repo); } catch {}
  const spec = store ? readJson(join(store, 'verify.json'), null) : null;
  const stacks = spec ? [] : profiles(repo);
  const checks = spec?.checks ?? stacks.flatMap((p) => p.checks ?? []);
  const all = args.includes('--all');
  const withTests = args.includes('--tests');
  const onlyChanged = args.includes('--changed');
  const { base, files } = changedFiles(repo);
  const source = spec ? 'verify.json' : stacks.length ? `profile ${stacks.map((p) => p.name).join('+')}` : 'no profile';
  console.log(`narvai verify: ${repo}  (${source}; ${files.length} changed file(s) vs ${base})`);
  if (!checks.length) { console.log('  no checks: add profiles/<stack> to the harness or verify.json to the store'); return; }
  const script = scriptRunner(repo);
  let failed = 0;
  for (const c of checks) {
    const hit = all || !Array.isArray(c.when) || files.some((f) => c.when.some((g) => matchesGlob(f, g)));
    if (!hit) { console.log(`  SKIPPED  ${c.name}  (no changed file matches)`); continue; }
    if (c.kind === 'test' && !withTests) { console.log(`  SKIPPED  ${c.name}  (a test check: narvai verify --tests, when the user asks for tests)`); continue; }
    if (c.requiresEnv && !process.env[c.requiresEnv]) { console.log(`  SKIPPED  ${c.name}  (${c.requiresEnv} not set, so it proves nothing)`); continue; }
    const cmd = script(c.scripts) ?? c.run;
    if (!cmd) { console.log(`  SKIPPED  ${c.name}  (no package.json script: ${c.scripts.join(', ')})`); continue; }
    if (!onlyChanged || !c.scope) { if (!runCheck(c.name, cmd, repo)) failed++; continue; }
    const depth = c.scope.split('/').length;
    const dirs = [...new Set(files.filter((f) => matchesGlob(f, `${c.scope}/**`)).map((f) => f.split('/').slice(0, depth).join('/')))]
      .filter((d) => existsSync(join(repo, d)));
    if (!dirs.length) console.log(`  SKIPPED  ${c.name}  (--changed: no changed file under ${c.scope})`);
    for (const d of dirs) if (!runCheck(`${c.name} ${d}`, `${cmd} ${d}`, repo)) failed++;
  }
  for (const m of spec?.manual ?? []) console.log(`  MANUAL   ${m}`);
  if (spec && spec.remoteCi === false) console.log('  (no remote CI: this run is the gate)');
  process.exit(failed ? 1 : 0);
}
