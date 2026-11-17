import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, matchesGlob, relative, resolve } from 'node:path';
import { appDir, git, HARNESS, harness, home, memory, out, readJson, repoFiles, repoRoot, storeFor, which } from './ortak.mjs';

export const slash = (p) => p.replace(/\\/g, '/');
const kb = (f) => `${(statSync(f).size / 1024).toFixed(1)} KB`;
const nonEmpty = (f) => existsSync(f) && statSync(f).isFile() && statSync(f).size > 0;

export function profiles(dir = join(HARNESS, 'profiles')) {
  return (existsSync(dir) ? readdirSync(dir) : [])
    .map((d) => ({ dir: join(dir, d), ...readJson(join(dir, d, 'profile.json'), {}) }))
    .filter((p) => p.name);
}

export { repoFiles };

export const stacksOf = (files, profs) => profs.filter((p) => p.detect?.some((g) => files.some((f) => matchesGlob(f, g))));

function scriptCmd(repo, pkg, script, scoped) {
  const pm = pkg.packageManager?.split('@')[0]
    || (existsSync(join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(repo, 'yarn.lock')) ? 'yarn' : existsSync(join(repo, 'bun.lock')) ? 'bun' : 'npm');
  return pm === 'npm' ? `npm run ${script}${scoped ? ' --' : ''}` : `${pm} ${script}`;
}

export function scriptFor(repo, names) {
  const pkg = readJson(join(repo, 'package.json'), null);
  const s = names.find((n) => pkg?.scripts?.[n]);
  return s ? scriptCmd(repo, pkg, s) : null;
}

// The store's verify.json replaces the profile checks; profile checks take package.json script names when present.
export function resolveChecks(repo, stacks, store) {
  const spec = store ? readJson(join(store, 'verify.json'), null) : null;
  if (spec?.checks) return { from: 'verify.json', checks: spec.checks, manual: spec.manual ?? [] };
  const pkg = readJson(join(repo, 'package.json'), null);
  const checks = stacks.flatMap((p) => (p.checks ?? []).flatMap(({ scripts, ...c }) => {
    const s = scripts?.find((n) => pkg?.scripts?.[n]);
    const run = s ? scriptCmd(repo, pkg, s, c.scope) : c.run;
    return run ? [{ ...c, run }] : [];
  }));
  return { from: `profile ${stacks.map((p) => p.name).join(', ')}`, checks, manual: [] };
}

const inside = (p, dir) => { const a = slash(p).toLowerCase(), b = slash(dir).toLowerCase(); return a === b || a.startsWith(b + '/'); };

function show(f, repo) {
  const p = slash(f), r = slash(repo), h = slash(home());
  if (p.toLowerCase().startsWith(r.toLowerCase() + '/')) return p.slice(r.length + 1);
  if (p.toLowerCase().startsWith(h.toLowerCase() + '/')) return '~' + p.slice(h.length);
  return p;
}

// Claude: cwd and every ancestor, AGENTS.md only when no CLAUDE.md is found. Codex: project root down to cwd, one file per directory.
export function ruleFiles(repo, cwd, codexHome = appDir('CODEX_HOME', '.codex')) {
  const up = [];
  for (let d = resolve(cwd); ; d = dirname(d)) { up.unshift(d); if (dirname(d) === d) break; }
  const own = up.flatMap((d) => ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].map((n) => join(d, n))).filter(nonEmpty);
  const claude = [join(home(), '.claude', 'CLAUDE.md'), ...(own.length ? own : up.map((d) => join(d, 'AGENTS.md')))].filter(nonEmpty);

  const toml = existsSync(join(codexHome, 'config.toml')) ? readFileSync(join(codexHome, 'config.toml'), 'utf8') : '';
  const fallback = [.../project_doc_fallback_filenames\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1].matchAll(/"([^"]+)"/g) ?? []].map((m) => m[1]);
  const pick = (d, names) => names.map((n) => join(d, n)).find(nonEmpty);
  const codex = [pick(codexHome, ['AGENTS.override.md', 'AGENTS.md']),
    ...up.filter((d) => inside(d, repo)).map((d) => pick(d, ['AGENTS.override.md', 'AGENTS.md', ...fallback]))].filter(Boolean);
  return { claude, codex };
}

const CLOSED = /^(done|complete|completed|closed|archived|merged|cancel+ed|abandoned)\b/i;

export function nextAction(yaml) {
  const m = /^next_action:[ \t]*(.*)$/m.exec(yaml);
  if (!m) return '';
  let v = m[1].trim();
  if (/^[>|][-+]?$/.test(v)) {
    const block = [];
    for (const l of yaml.slice(m.index + m[0].length).split(/\r?\n/).slice(1)) { if (l && !/^\s/.test(l)) break; if (l.trim()) block.push(l.trim()); }
    v = block.join(' ');
  }
  v = v.replace(/^(['"])(.*)\1$/, '$2');
  return v.length > 240 ? v.slice(0, 237) + '...' : v;
}

export function workItems(store) {
  const dir = join(store, 'work');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((id) => {
    const st = join(dir, id, 'state.yaml');
    if (!existsSync(st)) return [];
    const y = readFileSync(st, 'utf8');
    const status = /^status:[ \t]*([^#\r\n]+)/m.exec(y)?.[1].trim() ?? '';
    const branch = /^branch:[ \t]*([^\s#]+)/m.exec(y)?.[1] ?? '';
    return [{ id, dir: join(dir, id), status, branch, next: nextAction(y), open: Boolean(status) && !CLOSED.test(status) }];
  });
}

export function workLines(items, branch) {
  const open = items.filter((i) => i.open);
  const here = open.filter((i) => i.branch === branch);
  if (here.length === 1) {
    const w = here[0];
    const progress = existsSync(join(w.dir, 'PROGRESS.md')) ? `, ${slash(join(w.dir, 'PROGRESS.md'))}` : '';
    return [`work: ${w.id} [${w.status.slice(0, 40)}] ${slash(join(w.dir, 'state.yaml'))}${progress}`, `next_action: ${w.next || '(none recorded)'}`];
  }
  if (here.length > 1) return [`WARN ${here.length} open work items on branch ${branch}: ${here.map((i) => i.id).join(', ')}; ask the user which one`];
  const closed = items.find((i) => i.branch === branch);
  const lines = [`work: none open on branch ${branch}${closed ? ` (${closed.id} is ${closed.status.split(/\s/)[0]})` : ''}`];
  if (open.length) {
    const list = open.slice(0, 4).map((i) => `${i.id}@${i.branch || '?'}`).join(', ');
    lines.push(`WARN on "continue", the open items are on other branches (${open.length}): ${list}${open.length > 4 ? ', ...' : ''}; switch branch or ask which one`);
  }
  return lines;
}

// A first line `include: <path relative to the store folder>` is replaced by that file's lines.
export function projectRules(store) {
  const f = join(store, 'project-rules.md');
  if (!existsSync(f)) return { head: `project rules: none (${slash(f)})`, lines: [], path: slash(f) };
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  const inc = /^include:\s*(.+?)\s*$/.exec(lines[0] ?? '')?.[1];
  if (!inc) return { head: `project rules (${slash(f)}):`, lines: lines.filter((l) => l.trim()), path: slash(f) };
  const g = resolve(store, inc);
  const shared = existsSync(g) ? readFileSync(g, 'utf8').split(/\r?\n/) : [`WARN include not found: ${slash(g)}`];
  // The repository's own lines first: when the list is cut, the most specific rules survive.
  return { head: `project rules (${slash(f)} + ${slash(g)}):`, lines: [...lines.slice(1), ...shared].filter((l) => l.trim()), path: slash(f) };
}

// A project names its design skill in the store: Design skill: `<name>`. It usually lives in the repository itself.
export function projectDesign(repo, store) {
  const text = ['project-profile.md', 'project-rules.md'].map((f) => store && join(store, f)).filter((f) => f && existsSync(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  const name = /design skill:?\s*`([^`]+)`/i.exec(text)?.[1];
  if (!name) return null;
  const local = ['.claude', '.agents'].map((d) => join(repo, d, 'skills', name, 'SKILL.md')).find(existsSync);
  return { name, path: local };
}

export function clip(lines, limit, tail = 'more') {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit - 1), `... ${lines.length - limit + 1} ${tail}`];
}

export default async function run(args) {
  const hook = args.includes('--hook');
  const limit = 90;
  const cwd = process.cwd();
  const repo = repoRoot(cwd);
  if (!repo) { if (hook) return; throw new Error('not inside a git repository: cd into one'); }
  let store = null, storeLine;
  try {
    store = storeFor(repo);
    storeLine = store ? `store: ${slash(store)}` : 'store: none, this repo is not in map.json';
  } catch (e) { storeLine = `store: ${e.message}`; }
  if (hook && !store) return;

  const branch = git(['branch', '--show-current'], repo) || `detached ${git(['rev-parse', '--short', 'HEAD'], repo)}`;
  const files = repoFiles(repo);
  const stacks = stacksOf(files, profiles());
  const design = projectDesign(repo, store);
  const designLine = design?.path ? `design skill, read before UI work: ${design.name} ${slash(design.path)}` : null;
  const memoryLine = (m) => (!m ? null : m.live ? `memory: reachable${m.restarted ? ' (it was down and has been restarted)' : ''}` : `memory: NOT reachable at ${m.url}${m.restarted ? `; a restart was tried (${m.start})` : ''}. Tell the user before you rely on it.`);
  // Session start gets a digest that cannot be mistaken for the rules: the agent still has to ask for them.
  if (hook) {
    const mem = await memory();
    const { checks } = resolveChecks(repo, stacks, store);
    const work = workLines(workItems(store), branch).filter((l) => !l.startsWith('WARN on "continue"'));
    return out([
      `narvai session start: ${slash(repo)} @ ${branch}; stacks: ${stacks.map((p) => p.name).join(', ') || 'none'}; checks: ${checks.map((c) => c.name).join(', ') || 'none'}`,
      ...work,
      ...(designLine ? [designLine] : []),
      ...(mem && !(mem.live && !mem.restarted) ? [mem.live ? memoryLine(mem) : 'memory: not reachable; a restart was triggered. `narvai context` waits for it and reports.'] : []),
      'This is a digest, not the rules. Before you change code here, run `narvai context`: it prints the project rules and the stack rules.',
    ]);
  }
  const lines = [`narvai context: ${slash(repo)} @ ${branch} (${harness()})`];

  const rf = ruleFiles(repo, cwd);
  const list = (fs) => fs.map((f) => `${show(f, repo)} ${kb(f)}`).join(', ') || 'none';
  lines.push(`rules claude: ${list(rf.claude)}`);
  const codexBytes = rf.codex.reduce((n, f) => n + statSync(f).size, 0);
  lines.push(`rules codex: ${list(rf.codex)}${codexBytes > 32768 ? ' (over the 32 KiB project_doc_max_bytes default: later files are dropped)' : ''}`);
  const nested = files.filter((f) => /\/(CLAUDE|AGENTS)\.md$/.test(f) && f !== '.claude/CLAUDE.md');
  if (nested.length) lines.push(`rules nested, loaded when work reaches the folder: ${nested.slice(0, 6).join(', ')}${nested.length > 6 ? ` (+${nested.length - 6})` : ''}`);
  const stackRules = stacks.map((p) => join(p.dir, 'rules.md')).filter(existsSync);
  lines.push(`stacks: ${stacks.map((p) => p.name).join(', ') || 'none detected (no profile matches: add profiles/<stack>)'}`);

  const profile = store && join(store, 'project-profile.md');
  lines.push(storeLine + (profile && existsSync(profile) ? `; project-profile.md ${kb(profile)}` : ''));
  const { from, checks, manual } = resolveChecks(repo, stacks, store);
  lines.push(checks.length ? `checks (${from}; narvai verify runs them):` : 'checks: none (no profile matches and the store has no verify.json)');
  for (const c of checks) lines.push(`  ${c.name}: ${c.run}${c.scope ? ` <changed ${c.scope}>` : ''}${c.kind === 'test' ? '  (only with --tests)' : ''}`);
  for (const m of manual) lines.push(`  manual: ${m}`);
  if (store) lines.push(...workLines(workItems(store), branch));
  for (const p of stacks.filter((s) => s.lsp?.server)) {
    lines.push(`lsp ${p.name}: ${p.lsp.server} ${which(p.lsp.server) ? 'on PATH' : 'NOT on PATH'}; needs ${p.lsp.needs}`);
  }

  if (designLine) lines.push(designLine);
  const mem = memoryLine(await memory({ wait: 25000 }));
  if (mem) lines.push(mem);
  if (store) {
    const pr = projectRules(store);
    lines.push(pr.head);
    const room = limit - lines.length - stackRules.length * 20;
    lines.push(...clip(pr.lines, Math.max(room, 10), `more lines in ${pr.path}`));
  }
  for (const f of stackRules) lines.push(`stack rules (${slash(f)}):`, ...readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')));
  out(clip(lines, limit, 'lines cut'));
}
