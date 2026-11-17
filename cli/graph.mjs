import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { cfg, git, HARNESS, readJson, storeRoot } from './ortak.mjs';

const graphDir = () => join(storeRoot(), 'graph');
const short = (s) => (s ? s.replace(/^([0-9a-f]{8})[0-9a-f]*/, '$1') : '-');
const stateFile = (name) => join(graphDir(), `${name}.state.json`);
export const builtState = (name) => readJson(stateFile(name), null);

// What a graph has to match: the commit when the tree is clean, the commit plus a digest of every uncommitted change otherwise.
export function currentState(path) {
  const head = git(['rev-parse', 'HEAD'], path);
  if (!head) return '';
  const raw = (args) => { try { return execFileSync('git', args, { cwd: path, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return Buffer.alloc(0); } };
  const diff = raw(['diff', 'HEAD']);
  const untracked = raw(['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard']).toString().split('\n').filter(Boolean);
  if (!diff.length && !untracked.length) return head;
  const h = createHash('sha1').update(diff);
  for (const f of untracked) { const st = statSync(join(path, f), { throwIfNoEntry: false }); h.update(`${f}:${st?.size}:${st?.mtimeMs}\n`); }
  return `${head}+${h.digest('hex').slice(0, 12)}`;
}

// The repository a folder belongs to, by the main checkout of its worktree.
export function graphRepoFor(cwd, list = readJson(join(graphDir(), 'repos.json'), { repos: [] })) {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!common) return null;
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const name = list.repos?.find((r) => norm(r.path) === norm(dirname(common)))?.name;
  return name && /^[\w.-]+$/.test(name) ? name : null;
}

export function graphRows() {
  const dir = graphDir();
  const list = readJson(join(dir, 'repos.json'), { repos: [] });
  const index = readJson(join(dir, 'index.json'), {});
  return list.repos.map((r) => {
    const now = currentState(r.path);
    const built = builtState(r.name) ?? legacyState(index, r.name);
    const branch = r.branch || list.branch;
    const ref = branch && git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`], r.path);
    let state;
    if (!now) state = 'repo not found';
    else if (!built) state = 'no graph built';
    else if (built.state === now) state = now.includes('+') ? 'current (working tree)' : 'current (HEAD)';
    else if (built.state === ref) state = `current (origin/${branch}); the working tree differs`;
    else state = 'stale: the repository changed since the build';
    return { repo: r.name, path: r.path, built: built?.state ?? '', state, stale: state.startsWith('stale') };
  });
}

// Graphs built before state files existed are known only by the commits in index.json.
function legacyState(index, repo) {
  const commits = [...new Set([...(index.graphify ?? []).filter((g) => g.repo === repo).map((g) => g.commit), ...(index.graphs ?? []).filter((g) => g.graph?.startsWith(`${repo}/`)).map((g) => g.commit)])];
  return commits.length === 1 ? { state: commits[0], head: commits[0], builtAt: '' } : commits.length ? { state: 'mixed', head: '', builtAt: '' } : null;
}

function status(args) {
  const only = args[args.indexOf('--only') + 1];
  const rows = graphRows().filter((r) => !args.includes('--only') || r.repo === only);
  const lines = [`narvai graph status: ${graphDir()}`];
  for (const r of rows) lines.push(`  ${r.repo.padEnd(28)} ${short(r.built).padEnd(21)} ${r.state}`);
  const index = readJson(join(graphDir(), 'index.json'), {});
  const newer = (index.graphify ?? []).filter((g) => g.builtAt > (index.ecosystem?.builtAt ?? '')).length;
  if (index.ecosystem) lines.push(`  ${'(all repos merged)'.padEnd(28)} ${''.padEnd(21)} ${newer ? `stale: ${newer} repo graph(s) are newer; narvai graph build --merge` : 'current'}`);
  if (lines.length > 20) lines.splice(19, Infinity, `  ... ${lines.length - 19} more repos`);
  console.log(lines.join('\n'));
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function build(args) {
  const script = join(HARNESS, 'scripts', 'graph', 'ekosistem.mjs');
  const runScript = () => spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' }).status ?? 1;
  const only = args.includes('--only') && args[args.indexOf('--only') + 1];
  const worktree = args.includes('--worktree');
  if (!only || !(worktree || args.includes('--head'))) { process.exitCode = runScript(); return; }

  const dir = graphDir();
  const repo = readJson(join(dir, 'repos.json'), { repos: [] }).repos.find((r) => r.name === only);
  if (!repo) throw new Error(`${only} is not in ${join(dir, 'repos.json')}`);
  const lock = join(dir, `${only}.lock`);
  // A lock older than two hours is a crashed build, whatever process now owns that pid.
  let holder = 0;
  try { if (Date.now() - statSync(lock).mtimeMs < 2 * 3600_000) holder = Number(readFileSync(lock, 'utf8')); } catch {}
  if (holder && alive(holder)) { console.log(`graph build for ${only} already running (pid ${holder})`); return; }
  rmSync(lock, { force: true });
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch { console.log(`graph build for ${only} already running`); return; }
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
    // Changes that land while a build runs are picked up by the next pass; at most 3 passes.
    for (let pass = 0; pass < 3; pass++) {
      const built = builtState(only);
      const want = worktree ? currentState(repo.path) : git(['rev-parse', 'HEAD'], repo.path);
      if (built?.state === want) { console.log(`graph for ${only} is current: ${short(want)}`); return; }
      if (runScript() !== 0) { process.exitCode = 1; return; }
    }
  } finally { rmSync(lock, { force: true }); }
}

// Called in the background at session start: rebuild this repository's graphs from the working tree when they are stale,
// but not more often than every graphMinutes (default 30), so a busy day does not rebuild on every session.
function refresh(args) {
  const list = readJson(join(graphDir(), 'repos.json'), { repos: [] });
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : graphRepoFor(process.cwd(), list);
  const repo = list.repos.find((r) => r.name === only);
  if (!repo) return;
  const built = builtState(only);
  if (built?.state === currentState(repo.path)) return;
  const age = built?.builtAt ? Date.now() - Date.parse(built.builtAt) : Infinity;
  if (!args.includes('--now') && age < (cfg().graphMinutes ?? 30) * 60_000) return;
  build(['--only', only, '--worktree', '--no-fetch']);
}

export default async function run(args) {
  const [sub, ...rest] = args;
  if (sub === 'status') return status(rest);
  if (sub === 'build') return build(rest);
  if (sub === 'refresh') return refresh(rest);
  throw new Error('usage: narvai graph <build|status|refresh> [--only repo] [--worktree|--head] [--merge] [--now]');
}
