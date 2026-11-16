import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HARNESS, out, readJson } from './ortak.mjs';
import { profiles, slash } from './context.mjs';

export function description(file) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
  const m = /^description:[ \t]*(.*)$/m.exec(fm);
  if (!m) return '';
  let v = m[1].trim();
  if (/^[>|][-+]?$/.test(v)) {
    const block = [];
    for (const l of fm.slice(m.index + m[0].length).split(/\r?\n/).slice(1)) { if (l && !/^\s/.test(l)) break; if (l.trim()) block.push(l.trim()); }
    v = block.join(' ');
  }
  return v.replace(/^(['"])(.*)\1$/, '$2');
}

function scan(root, source) {
  const found = [];
  for (const d of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
    if (!d.isDirectory()) continue;
    const dir = join(root, d.name);
    if (existsSync(join(dir, 'SKILL.md'))) { found.push({ name: d.name, id: d.name, source, path: join(dir, 'SKILL.md') }); continue; }
    for (const s of readdirSync(dir, { withFileTypes: true })) {
      if (s.isDirectory() && existsSync(join(dir, s.name, 'SKILL.md'))) found.push({ name: s.name, id: `${d.name}/${s.name}`, set: d.name, source, path: join(dir, s.name, 'SKILL.md') });
    }
  }
  return found;
}

// registry/skills.json (written by sync) first; skills on disk it does not list are found by folder name.
export function skillIndex(harness = HARNESS) {
  const reg = readJson(join(harness, 'registry', 'skills.json'), []);
  const rows = Array.isArray(reg) ? reg : Array.isArray(reg.skills) ? reg.skills : Object.entries(reg.skills ?? reg).map(([id, v]) => ({ id, ...v }));
  const fromReg = rows.filter((r) => r?.path && (r.name || r.id)).map((r) => {
    const p = resolve(harness, r.path);
    return { ...r, name: r.name ?? r.id.split('/').pop(), id: r.id ?? r.name, path: p.endsWith('SKILL.md') ? p : join(p, 'SKILL.md') };
  });
  const known = new Set(fromReg.map((r) => slash(r.path).toLowerCase()));
  const disk = [...scan(join(harness, 'skills'), 'own'), ...scan(join(harness, 'third-party', 'skills'), 'third-party')]
    .filter((s) => !known.has(slash(s.path).toLowerCase()));
  return [...fromReg, ...disk];
}

// Accepts `name`, `set/name` and the plugin form `set:name`.
export function findSkill(index, name) {
  const id = name.replace(':', '/');
  return index.find((s) => s.id === id) ?? index.find((s) => s.name === id.split('/').pop());
}

function usage(name) {
  const routes = readJson(join(HARNESS, 'registry', 'routes.json'), {});
  const tags = [];
  if (routes.listed?.includes(name)) tags.push('listed');
  for (const p of profiles()) if (p.skills?.includes(name)) tags.push(`stack:${p.name}`);
  const r = (routes.routes ?? []).filter((x) => x.skills.includes(name)).map((x) => x.id);
  if (r.length) tags.push(`route:${r.join(',')}`);
  return tags.join(' ') || 'by name only';
}

export default async function run(args) {
  const index = skillIndex();
  if (args[0] === '--list') {
    const stack = args.includes('--stack') ? args[args.indexOf('--stack') + 1] : null;
    const only = stack && profiles().find((p) => p.name === stack);
    if (stack && !only) throw new Error(`no profile named ${stack}: ${profiles().map((p) => p.name).join(', ')}`);
    const rows = index.filter((s) => !only || only.skills?.includes(s.name)).sort((a, b) => a.id.localeCompare(b.id));
    const w = Math.max(...rows.map((s) => s.id.length), 4);
    out([`${rows.length} skills${only ? ` for ${stack}` : ''}`, ...rows.map((s) => `${s.id.padEnd(w)}  ${(s.fit ?? s.source ?? '').padEnd(11)}  ${usage(s.name)}`)]);
    return;
  }
  const name = args[0];
  if (!name) throw new Error('usage: narvai skill <name> | --list [--stack s]');
  const s = findSkill(index, name);
  if (!s) {
    const close = index.filter((x) => x.id.includes(name) || name.includes(x.name)).slice(0, 5).map((x) => x.id);
    throw new Error(`no skill named ${name}${close.length ? `; close: ${close.join(', ')}` : ''}; see narvai skill --list`);
  }
  const desc = existsSync(s.path) ? description(s.path) : s.description ?? '';
  out([`${s.id}  ${slash(s.path)}`, desc, `use: ${usage(s.name)}${s.fit ? `; fit ${s.fit}${s.reason ? `: ${s.reason}` : ''}` : ''}`].filter(Boolean));
}
