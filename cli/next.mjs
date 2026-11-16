import { existsSync, readFileSync } from 'node:fs';
import { join, matchesGlob, relative, resolve } from 'node:path';
import { HARNESS, out, readJson, repoRoot, storeFor } from './ortak.mjs';
import { clip, slash } from './context.mjs';
import { findSkill, skillIndex } from './skill.mjs';

const CHECKPOINTS = { done: ['run: narvai verify', 'run: narvai tests'], contract: ['run: narvai contract'] };

export const firing = (routes, event, paths) => routes.filter((r) => r.when?.event === event
  && (!r.when.paths || paths.some((p) => r.when.paths.some((g) => matchesGlob(p, g)))));

function projectDesign(repo, store) {
  const text = ['project-profile.md', 'project-rules.md'].map((f) => store && join(store, f)).filter((f) => f && existsSync(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  const name = /design skill:?\s*`([^`]+)`/i.exec(text)?.[1];
  if (!name) return null;
  const local = ['.claude', '.agents'].map((d) => join(repo, d, 'skills', name, 'SKILL.md')).find(existsSync);
  return { name, path: local };
}

export function skillLines(routes, event, paths, resolveSkill) {
  const seen = new Set();
  const lines = [];
  for (const r of firing(routes, event, paths)) {
    let why = r.why;
    for (const name of r.skills) {
      const s = resolveSkill(name);
      const key = s?.name ?? name;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(s?.path ? `${s.name}  ${slash(s.path)}${why ? `  ${why}` : ''}` : `missing: ${s?.name ?? name}  ${s?.hint ?? ''}`.trimEnd());
      if (s?.path) why = '';
    }
  }
  return lines;
}

export default async function run(args) {
  const at = args.indexOf('--event');
  const event = at >= 0 ? args[at + 1] : undefined;
  const { routes = [] } = readJson(join(HARNESS, 'registry', 'routes.json'), {});
  const events = [...new Set([...routes.map((r) => r.when?.event), ...Object.keys(CHECKPOINTS)])].filter(Boolean);
  if (!event || !events.includes(event)) throw new Error(`${event ? `unknown event ${event}` : 'missing --event'}; events: ${events.join(', ')}`);

  const repo = repoRoot();
  const rest = args.includes('--paths') ? args.slice(args.indexOf('--paths') + 1) : [];
  const end = rest.findIndex((a) => a.startsWith('--'));
  const paths = (end < 0 ? rest : rest.slice(0, end)).flatMap((a) => a.split(',')).filter(Boolean).map((p) => slash(repo ? relative(repo, resolve(p)) : p));

  let store = null;
  try { store = repo && storeFor(repo); } catch {}
  const index = skillIndex();
  const resolveSkill = (name) => {
    if (name === '@project-design') {
      const d = repo && projectDesign(repo, store);
      if (!d) return { name, hint: 'name it in the store project-profile.md as: Design skill: `<name>`' };
      return d.path ? d : findSkill(index, d.name) ?? { name: d.name };
    }
    return findSkill(index, name) ?? { name };
  };
  const lines = [...skillLines(routes, event, paths, resolveSkill), ...(CHECKPOINTS[event] ?? [])];
  out(lines.length ? clip(lines, 12) : [`nothing fires for ${event}${paths.length ? ' on these paths' : ''}`]);
}
