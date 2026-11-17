import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS, harness, home, readJson, repoRoot, storeFor } from '../cli/ortak.mjs';
import { projectDesign } from '../cli/context.mjs';
import { pathHit } from '../cli/next.mjs';

const SHELL = /^(?:Bash|PowerShell)$/;
const EDIT = /^(?:Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/;
const cli = () => join(HARNESS, 'narvai.mjs').replace(/\\/g, '/');

export const allowPath = () => join(home(), '.narvai', 'allow.json');
// A file that does not parse counts as empty, so one broken file never switches the other rules off.
const load = (file) => { try { return readJson(file, {}); } catch { return {}; } };
export const rules = () => [...load(join(HARNESS, 'hooks', 'deny.json')).rules ?? [], ...load(join(home(), '.narvai', 'guard.json')).rules ?? []];
export const exceptions = () => load(allowPath());

const patchPaths = (patch) => [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((m) => m[1].trim());

export function normalise(p, h) {
  const tool = p.tool_name ?? '';
  const input = p.tool_input ?? {};
  const command = typeof input.command === 'string' ? input.command : tool.startsWith('mcp__') ? JSON.stringify(input) : '';
  const paths = tool === 'apply_patch' ? patchPaths(command) : [input.file_path ?? input.notebook_path].filter(Boolean);
  return { harness: h, event: p.hook_event_name ?? '', tool, command, paths, cwd: p.cwd ?? process.cwd(), session: String(p.session_id ?? 'none') };
}

// A rule without `tool` is a shell rule. A rule whose expression does not compile is skipped, alone.
export function denied(n, list, allow = {}, now = Date.now()) {
  const shell = SHELL.test(n.tool);
  const hit = (r, re, s) => { try { return new RegExp(re, r.cs ? '' : 'i').test(s); } catch { return false; } };
  return list.find((r) => {
    if (r.tool ? !hit(r, r.tool, n.tool) : !(r.command && shell)) return false;
    if (r.command && !hit(r, r.command, n.command)) return false;
    if (r.path && !n.paths.some((p) => hit(r, r.path, p.replaceAll('\\', '/')))) return false;
    return r.fixed || !(Date.parse(allow[r.id]) > now);
  });
}

const rel = (p, cwd) => {
  const r = relative(cwd, resolve(cwd, p));
  return (r.startsWith('..') || isAbsolute(r) ? resolve(cwd, p) : r).replace(/\\/g, '/');
};

export function routeHits(n, routes, fired = []) {
  if (!EDIT.test(n.tool) || !n.paths.length) return [];
  const paths = n.paths.map((p) => rel(p, n.cwd));
  return routes.filter((r) => r.when?.event === 'edit' && r.when.paths && !fired.includes(r.id) && paths.some((p) => pathHit(r.when, p)));
}

function skillPath(name) {
  const dirs = [join(HARNESS, 'skills'), join(HARNESS, 'third-party', 'skills'), join(home(), '.claude', 'skills'), join(home(), '.agents', 'skills')];
  const hit = dirs.map((d) => join(d, name, 'SKILL.md')).find(existsSync);
  return hit ? hit.replace(/\\/g, '/') : `(node "${cli()}" skill ${name})`;
}

function editContext(n) {
  const state = join(tmpdir(), 'narvai-guard', `${n.session.replace(/[^\w-]/g, '_')}.json`);
  const fired = readJson(state, []);
  const hits = routeHits(n, readJson(join(HARNESS, 'registry', 'routes.json'), {}).routes ?? [], fired);
  if (!hits.length) return;
  mkdirSync(join(tmpdir(), 'narvai-guard'), { recursive: true });
  writeFileSync(state, JSON.stringify([...fired, ...hits.map((r) => r.id)]));
  const top = repoRoot(n.cwd);
  let store = null;
  try { store = top && storeFor(top); } catch {}
  const design = top && projectDesign(top, store);
  const named = (s) => (s === '@project-design' ? design?.path && `${design.name} ${design.path.replaceAll('\\', '/')}` : `${s} ${skillPath(s)}`);
  return hits.map((r) => {
    const skills = r.skills.map(named).filter(Boolean);
    return skills.length ? `narvai ${r.id}: ${r.why}. Read before you go on, if you have not in this task: ${skills.join('; ')}` : `narvai ${r.id}: ${r.why}.`;
  }).join('\n');
}

function sessionContext(n) {
  const top = repoRoot(n.cwd);
  if (!top || !storeFor(top)) return;
  return execFileSync(process.execPath, [cli(), 'context', '--hook'], { cwd: n.cwd, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
}

function main() {
  const n = normalise(JSON.parse(readFileSync(0, 'utf8')), process.argv[2] ?? harness());
  const reply = (o) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: n.event, ...o } }));
  if (n.event === 'SessionStart') {
    const text = sessionContext(n);
    if (text) {
      reply({ additionalContext: text });
      // Graphs follow the working tree: a stale one is rebuilt in the background, detached from this session.
      spawn(process.execPath, [cli(), 'graph', 'refresh'], { cwd: n.cwd, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } else if (n.event === 'PreToolUse') {
    const r = denied(n, rules(), exceptions());
    if (r) return reply({ permissionDecision: 'deny', permissionDecisionReason: `${r.reason} Instead: ${r.instead}${r.fixed ? '' : ` Only the user can grant an exception, in their own terminal: narvai allow ${r.id}`}` });
    const text = editContext(n);
    if (text) reply({ additionalContext: text });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
}
