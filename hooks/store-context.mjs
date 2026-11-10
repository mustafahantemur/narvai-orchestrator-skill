// SessionStart hook: tells the agent where the repo's external store is, which work item belongs to the current
// branch, and after a compaction to re-read that item's notes. Silent outside repos in map.json.
// Usage: node store-context.mjs [compact]. Does not read stdin; the working directory is enough.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const empty = () => { process.stdout.write('{}'); process.exit(0); };
const source = process.argv[2] ?? '';
const cfgPath = join(homedir(), '.narvai', 'config.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const root = process.env.AI_HARNESS_MEMORY ?? cfg.storeRoot;
const mapPath = root && join(root, 'map.json');
if (!mapPath || !existsSync(mapPath)) empty();

const norm = (p) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const map = new Map(Object.entries(JSON.parse(readFileSync(mapPath, 'utf8'))).map(([r, s]) => [norm(r), [r, s]]));
let probe = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
let hit = null;
for (let i = 0; i < 64 && !hit; i++) {
  hit = map.get(norm(probe)) ?? null;
  const up = dirname(probe);
  if (up === probe) break;
  probe = up;
}
if (!hit || !existsSync(hit[1])) empty();
const [repo, store] = hit;

const lines = [`AI store for this project: ${store}`, 'It lives outside the repository on purpose. Never write harness bookkeeping into the repo.'];
const filled = ['project-profile.md', 'invariants.md', 'requirements.md'].filter((f) => existsSync(join(store, f)) && statSync(join(store, f)).size > 200);
if (filled.length) lines.push(`Filled: ${filled.join(', ')} - read project-profile.md before exploring the repository.`);

const work = join(store, 'work');
if (existsSync(work)) {
  let current = '';
  try { current = execFileSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  let others = 0;
  for (const d of readdirSync(work, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const st = join(work, d.name, 'state.yaml');
    if (!existsSync(st)) continue;
    const y = readFileSync(st, 'utf8');
    const status = /^status:\s*([^#\r\n]+)/m.exec(y)?.[1].trim();
    const branch = /^branch:\s*([^\s#]+)/m.exec(y)?.[1];
    if (!status || ['done', 'archived', 'closed'].includes(status)) continue;
    if (current && branch === current) {
      lines.push(`Work item on this branch (${current}): ${st}. On 'devam et' resume from its next_action instead of re-discovering the repository.`);
      if (source === 'compact') lines.push(`Context was just compacted. Before the next step re-read ${join(work, d.name, 'PROGRESS.md')} and its state.yaml; where they differ from the summary, they win.`);
    } else others++;
  }
  if (others) lines.push(`Other open work items: ${others} in ${work} (read one only when the user names it).`);
}
const graph = join(store, 'graphify', 'graph.json');
if (existsSync(graph)) lines.push(`Code graph: ${graph} (query with graphify --graph ... --budget ...).`);

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }));
