import { join, matchesGlob, relative, resolve } from 'node:path';
import { HARNESS, out, readJson, repoRoot, storeFor } from './ortak.mjs';
import { clip, projectDesign, slash } from './context.mjs';
import { findSkill, skillIndex } from './skill.mjs';

const CHECKPOINTS = { done: ['run: narvai verify', 'run: narvai tests'], contract: ['run: narvai contract'] };

// `paths` narrows a route to matching files; `except` takes some of them out again (tests, stories, generated files).
export const pathHit = (when, p) => when.paths.some((g) => matchesGlob(p, g)) && !(when.except ?? []).some((g) => matchesGlob(p, g));
export const firing = (routes, event, paths) => routes.filter((r) => r.when?.event === event && (!r.when.paths || paths.some((p) => pathHit(r.when, p))));

export function skillLines(routes, event, paths, resolveSkill) {
  const seen = new Set();
  const lines = [];
  for (const r of firing(routes, event, paths)) {
    let why = r.why;
    if (!r.skills.length) lines.push(`note: ${r.why}`);
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
  const byPath = routes.filter((r) => r.when?.event === event && r.when.paths).map((r) => r.id);
  if (!paths.length && byPath.length) lines.push(`more with --paths <files>: ${byPath.join(', ')}`);
  out(lines.length ? clip(lines, 12) : [`nothing fires for ${event}${paths.length ? ' on these paths' : ''}`]);
}
