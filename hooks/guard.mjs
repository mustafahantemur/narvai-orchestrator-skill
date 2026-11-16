import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS, harness, home, readJson, repoRoot, storeFor } from '../cli/ortak.mjs';

const SHELL = /^(?:Bash|PowerShell)$/;
const EDIT = /^(?:Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/;
const cli = () => join(HARNESS, 'narvai.mjs').replace(/\\/g, '/');

export const allowPath = () => join(home(), '.narvai', 'allow.json');
export const rules = () => [...readJson(join(HARNESS, 'hooks', 'deny.json'), {}).rules ?? [], ...readJson(join(home(), '.narvai', 'guard.json'), {}).rules ?? []];

const patchPaths = (patch) => [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((m) => m[1].trim());

export function normalise(p, h) {
  const tool = p.tool_name ?? '';
  const input = p.tool_input ?? {};
  const command = typeof input.command === 'string' ? input.command : tool.startsWith('mcp__') ? JSON.stringify(input) : '';
  const paths = tool === 'apply_patch' ? patchPaths(command) : [input.file_path ?? input.notebook_path].filter(Boolean);
  return { harness: h, event: p.hook_event_name ?? '', tool, command, paths, cwd: p.cwd ?? process.cwd(), session: String(p.session_id ?? 'none') };
}

export function denied(n, list, allow = {}, now = Date.now()) {
  if (!SHELL.test(n.tool) && !n.tool.startsWith('mcp__')) return undefined;
  const hit = (re, s) => !re || new RegExp(re, 'i').test(s);
  return list.find((r) => (r.tool || r.command) && hit(r.tool, n.tool) && hit(r.command, n.command) && !(Date.parse(allow[r.id]) > now));
}

const rel = (p, cwd) => {
  const r = relative(cwd, resolve(cwd, p));
  return (r.startsWith('..') || isAbsolute(r) ? resolve(cwd, p) : r).replace(/\\/g, '/');
};

export function routeHits(n, routes, fired = []) {
  if (!EDIT.test(n.tool) || !n.paths.length) return [];
  const paths = n.paths.map((p) => rel(p, n.cwd));
  return routes.filter((r) => r.when?.event === 'edit' && !fired.includes(r.id) && paths.some((p) => r.when.paths?.some((g) => matchesGlob(p, g))));
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
  return hits.map((r) => `narvai ${r.id} (${r.why}): ${r.skills.filter((s) => !s.startsWith('@')).map((s) => `${s} ${skillPath(s)}`).join('; ')}`).join('\n');
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
    if (text) reply({ additionalContext: text });
  } else if (n.event === 'PreToolUse') {
    const r = denied(n, rules(), readJson(allowPath(), {}));
    if (r) return reply({ permissionDecision: 'deny', permissionDecisionReason: `${r.reason} Instead: ${r.instead} Exception, only if the user agrees: node "${cli()}" allow ${r.id}` });
    const text = editContext(n);
    if (text) reply({ additionalContext: text });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
}
