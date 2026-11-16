import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { git, HARNESS, readJson, storeRoot } from './ortak.mjs';

const graphDir = () => join(storeRoot(), 'graph');
const short = (c) => (c ? c.slice(0, 8) : '-');

export function builtCommits(index, repo, args = []) {
  return [
    ...(args.includes('--skip-graphify') ? [] : (index.graphify ?? []).filter((g) => g.repo === repo).map((g) => g.commit)),
    ...(args.includes('--skip-ua') ? [] : (index.graphs ?? []).filter((g) => g.graph?.startsWith(`${repo}/`)).map((g) => g.commit)),
  ];
}

export function graphRows() {
  const dir = graphDir();
  const list = readJson(join(dir, 'repos.json'), { repos: [] });
  const index = readJson(join(dir, 'index.json'), {});
  return list.repos.map((r) => {
    const commits = [...new Set(builtCommits(index, r.name))];
    const head = git(['rev-parse', 'HEAD'], r.path);
    const branch = r.branch || list.branch;
    const ref = branch && git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`], r.path);
    const state = (c) => {
      if (!head) return 'repo not found';
      if (c === head) return 'current (HEAD)';
      if (c === ref) return `current (origin/${branch}), HEAD differs`;
      const n = git(['rev-list', '--count', `${c}..HEAD`], r.path);
      return n ? `stale: HEAD is ${n} commit(s) ahead` : 'stale: commit not in this repo';
    };
    return { repo: r.name, path: r.path, head, commits, states: commits.map(state) };
  });
}

function status(args) {
  const only = args[args.indexOf('--only') + 1];
  const rows = graphRows().filter((r) => !args.includes('--only') || r.repo === only);
  const lines = [`narvai graph status: ${graphDir()}`];
  for (const r of rows) {
    const what = r.commits.length ? r.commits.map((c, i) => `${short(c)} ${r.states[i]}`).join('; ') : 'no graph built';
    lines.push(`  ${r.repo.padEnd(28)} ${what}`);
  }
  const index = readJson(join(graphDir(), 'index.json'), {});
  const newer = (index.graphify ?? []).filter((g) => g.builtAt > (index.ecosystem?.builtAt ?? '')).length;
  if (index.ecosystem) lines.push(`  ${'(all repos merged)'.padEnd(28)} ${newer ? `stale: ${newer} repo graph(s) are newer; narvai graph build --merge` : 'current'}`);
  if (lines.length > 20) lines.splice(19, Infinity, `  ... ${lines.length - 19} more repos`);
  console.log(lines.join('\n'));
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function build(args) {
  const script = join(HARNESS, 'scripts', 'graph', 'ekosistem.mjs');
  const runScript = () => spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' }).status ?? 1;
  const only = args.includes('--only') && args[args.indexOf('--only') + 1];
  if (!only || !args.includes('--head')) process.exit(runScript());

  const dir = graphDir();
  const repo = readJson(join(dir, 'repos.json'), { repos: [] }).repos.find((r) => r.name === only);
  if (!repo) throw new Error(`${only} is not in ${join(dir, 'repos.json')}`);
  const lock = join(dir, `${only}.lock`);
  let holder = 0;
  try { holder = Number(readFileSync(lock, 'utf8')); } catch {}
  if (holder && alive(holder)) { console.log(`graph build for ${only} already running (pid ${holder})`); return; }
  writeFileSync(lock, String(process.pid));
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
    // Commits that land while a build runs are picked up by the next pass; ponytail: at most 3 passes.
    for (let pass = 0; pass < 3; pass++) {
      const head = git(['rev-parse', 'HEAD'], repo.path);
      const built = builtCommits(readJson(join(dir, 'index.json'), {}), only, args);
      if (built.length && built.every((c) => c === head)) { console.log(`graph for ${only} is at HEAD ${short(head)}`); return; }
      if (runScript() !== 0) { process.exitCode = 1; return; }
    }
  } finally { rmSync(lock, { force: true }); }
}

export default async function run(args) {
  const [sub, ...rest] = args;
  if (sub === 'status') return status(rest);
  if (sub === 'build') return build(rest);
  throw new Error('usage: narvai graph <build|status> [--only repo] [--head] [--merge]');
}
