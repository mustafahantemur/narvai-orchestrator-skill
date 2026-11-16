// PostToolUse (Bash): after a commit, merge, pull, rebase or cherry-pick, moves the store copy of
// Understand-Anything to the new HEAD and tells the agent to refresh the graphs that opted in.
// The graphs live in one shared folder (<storeRoot>/graph/<repo folder>), never in the repo; the
// plugin's own hook looks for .ua/ in the repo and would never fire.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const cfgPath = join(homedir(), '.narvai', 'config.json');
const storeRoot = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')).storeRoot : undefined;
const MAP_PATH = process.env.UA_HARNESS_MAP ?? (storeRoot ? join(storeRoot, 'map.json') : 'C:/Projects/AI/Features/_harness/map.json');
const PLUGIN_ROOT = process.env.UA_PLUGIN_ROOT ?? join(homedir(), '.understand-anything-plugin');
const GIT_CHANGE = /\bgit\s+(?:-C\s+("[^"]+"|'[^']+'|\S+)\s+)?(?:commit|merge|pull|rebase|cherry-pick)\b/;

const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const norm = (p) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function commandDir(command, cwd) {
  const viaFlag = command.match(GIT_CHANGE)?.[1];
  const viaCd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/)?.[1];
  const raw = (viaFlag ?? viaCd)?.replace(/^["']|["']$/g, '');
  if (!raw) return cwd;
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

function optedInGraphs(src) {
  const roots = [src];
  const modules = join(src, 'src', 'Modules');
  if (existsSync(modules)) {
    for (const d of readdirSync(modules, { withFileTypes: true })) if (d.isDirectory()) roots.push(join(modules, d.name));
  }
  return roots.filter((root) =>
    existsSync(join(root, '.ua', 'knowledge-graph.json')) && readJson(join(root, '.ua', 'config.json'))?.autoUpdate === true);
}

async function main() {
  const payload = JSON.parse(await readStdin());
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !GIT_CHANGE.test(command)) return;

  const top = git(commandDir(command, payload.cwd ?? process.cwd()), 'rev-parse', '--show-toplevel');
  const map = readJson(MAP_PATH) ?? {};
  const store = Object.entries(map).find(([repo]) => norm(repo) === norm(top))?.[1];
  if (!store) return;

  // A worktree's top level is the worktree folder; the common git dir names the main repo.
  const mainRepo = dirname(git(top, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  const src = join(dirname(MAP_PATH), 'graph', basename(mainRepo));
  const graphs = optedInGraphs(src);
  if (graphs.length === 0) return;

  const head = git(top, 'rev-parse', 'HEAD');
  const behind = graphs.filter((root) => readJson(join(root, '.ua', 'meta.json'))?.gitCommitHash !== head);
  if (behind.length === 0) return;

  git(src, 'fetch', '--quiet', top, 'HEAD');
  git(src, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');

  const additionalContext =
    `[understand-anything] ${head.slice(0, 8)} in ${top}: store graph(s) are behind and the store copy is now ` +
    `checked out at that commit. For each path below, read ${PLUGIN_ROOT}/hooks/auto-update-prompt.md and run ` +
    `it with PROJECT_ROOT set to that path (never the repo): ${behind.join(' | ')}. ` +
    'SKIP, PARTIAL_UPDATE and ARCHITECTURE_UPDATE run without asking (user, 2026-11-10). ' +
    'If the plan says FULL_UPDATE, do not start a full rebuild: tell the user the changed file count and ask. ' +
    'Report in one line which skill ran and what changed.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
}

main().catch(() => {});
