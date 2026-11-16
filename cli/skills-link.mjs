import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { backup, HARNESS, home, readJson, sameDir, skillTargets } from './ortak.mjs';

const ROOTS = ['skills', 'third-party/skills'];
const REGISTRY = join(HARNESS, 'registry', 'skills.json');
const n = (x) => x.toLocaleString('en-US');

export function frontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fm = {};
  const lines = block ? block[1].split(/\r?\n/) : [];
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const more = [];
    while (i + 1 < lines.length && /^(\s|$)/.test(lines[i + 1])) more.push(lines[++i].trim());
    let v = /^[>|][-+]?$/.test(kv[2]) ? more.join(kv[2][0] === '|' ? '\n' : ' ') : [kv[2], ...more].join(' ');
    v = v.trim();
    if (/^".*"$/s.test(v)) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    else if (/^'.*'$/s.test(v)) v = v.slice(1, -1).replaceAll("''", "'");
    fm[kv[1]] = v;
  }
  return fm;
}

export function scan(harness = HARNESS) {
  const sources = readJson(join(harness, 'third-party.json'), { sources: [] }).sources;
  const owner = new Map(sources.flatMap((s) => s.skills.map((k) => [k, s])));
  const found = [];
  for (const rel of ROOTS) {
    const root = join(harness, rel);
    for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
      const md = join(root, name, 'SKILL.md');
      if (!existsSync(md)) continue;
      const text = readFileSync(md, 'utf8').replace(/\r\n/g, '\n');
      const fm = frontmatter(text);
      const src = rel === 'skills' ? { set: 'narvai', repo: 'own', commit: '-', license: '-' } : owner.get(name) ?? { set: 'unrecorded' };
      found.push({
        id: `${src.set}/${name}`, name, set: src.set, source: src.repo ?? null, commit: src.commit ?? null, license: src.license ?? null,
        path: `${rel}/${name}`, descChars: (fm.description ?? '').length + (fm.when_to_use ?? '').length, skillMdBytes: Buffer.byteLength(text),
      });
    }
  }
  return found;
}

// The bare name goes to the copy routes.json names by id (<set>/<name>); otherwise to the first found, own skills first.
export function registry(found, routes = {}, prev = []) {
  const named = new Set([...(routes.listed ?? []), ...(routes.routes ?? []).flatMap((r) => r.skills ?? [])]);
  const old = new Map(prev.map((s) => [s.id, s]));
  return found.map((s) => {
    const same = found.filter((c) => c.name === s.name);
    const o = old.get(s.id);
    return { id: s.id, name: s.name, set: s.set, fit: o?.fit ?? 'unreviewed', reason: o?.reason ?? '', bare: (same.find((c) => named.has(c.id)) ?? same[0]) === s,
      source: s.source, commit: s.commit, license: s.license, path: s.path, descChars: s.descChars, skillMdBytes: s.skillMdBytes };
  });
}

export const resolveSkill = (name, reg) => (name.includes('/') ? reg.find((s) => s.id === name) : reg.find((s) => s.bare && s.name === name));

export function routeNames(routes, profiles = []) {
  const all = [...(routes.listed ?? []), ...profiles.flatMap((p) => p.skills ?? []), ...(routes.routes ?? []).flatMap((r) => r.skills ?? [])];
  return [...new Set(all)].filter((x) => !x.startsWith('@'));
}

export function listedSet(reg, routes, profiles = []) {
  const names = [...new Set([...(routes.listed ?? []), ...profiles.flatMap((p) => p.skills ?? [])])].filter((x) => !x.startsWith('@'));
  const skills = [];
  const missing = [];
  for (const x of names) {
    const s = resolveSkill(x, reg);
    if (!s) missing.push(x);
    else if (!skills.includes(s)) skills.push(s);
  }
  return { skills, missing };
}

const norm = (p) => {
  const r = resolve(p.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

// A link narvai made: a symlink or junction whose target lies inside one of the hub roots.
export function isHubLink(p, hub) {
  const st = lstatSync(p, { throwIfNoEntry: false });
  if (!st?.isSymbolicLink()) return false;
  const target = norm(resolve(dirname(p), readlinkSync(p)));
  return hub.some((h) => target.startsWith(norm(h) + sep));
}

export function linkInto(dir, want, hub) {
  const res = { linked: [], removed: [], skipped: [] };
  mkdirSync(dir, { recursive: true });
  for (const [name, src] of want) {
    const dst = join(dir, name);
    if (lstatSync(dst, { throwIfNoEntry: false })) {
      if (sameDir(src, dst)) continue;
      if (!isHubLink(dst, hub)) { res.skipped.push(name); continue; }
      unlinkSync(dst);
    }
    symlinkSync(src, dst, 'junction');
    res.linked.push(name);
  }
  for (const name of readdirSync(dir)) {
    if (want.has(name) || !isHubLink(join(dir, name), hub)) continue;
    unlinkSync(join(dir, name));
    res.removed.push(name);
  }
  return res;
}

function writeRegistry(reg) {
  const body = `{\n  "about": "Generated by narvai sync from skills/ and third-party/skills/. fit and reason are the review and survive regeneration; every other field is rewritten.",\n  "skills": [\n${reg.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]\n}\n`;
  if (existsSync(REGISTRY) && readFileSync(REGISTRY, 'utf8') === body) return false;
  mkdirSync(dirname(REGISTRY), { recursive: true });
  writeFileSync(REGISTRY, body);
  return true;
}

const profiles = () => {
  const dir = join(HARNESS, 'profiles');
  return existsSync(dir) ? readdirSync(dir).map((d) => readJson(join(dir, d, 'profile.json'), null)).filter(Boolean) : [];
};

export function linkSkills() {
  const routes = readJson(join(HARNESS, 'registry', 'routes.json'), {});
  const prev = readJson(REGISTRY, { skills: [] }).skills;
  const reg = registry(scan(), routes, prev);
  const changed = writeRegistry(reg);
  const open = reg.filter((s) => s.fit === 'unreviewed').length;
  console.log(`  ${open ? 'WARN' : 'OK  '} registry ${changed ? 'written' : 'current'}: ${reg.length} skills${open ? `, ${open} unreviewed` : ''}`);
  const gaps = routeNames(routes, profiles()).filter((x) => !resolveSkill(x, reg));
  if (gaps.length) console.log(`  WARN not in the registry (routes.json or a profile names them): ${gaps.join(', ')}`);
  const { skills } = listedSet(reg, routes, profiles());
  const want = new Map(skills.map((s) => [s.name, join(HARNESS, s.path)]));
  const hub = ROOTS.map((r) => join(HARNESS, r));
  for (const dir of skillTargets()) {
    const r = linkInto(dir, want, hub);
    console.log(`  OK   ${want.size} listed skills in ${dir}${r.linked.length ? `, linked ${r.linked.length}` : ''}${r.removed.length ? `, unlinked ${r.removed.length}` : ''}`);
    if (r.skipped.length) console.log(`  WARN left alone in ${dir} (a folder or a link narvai did not make): ${r.skipped.join(', ')}`);
  }
  const chars = skills.map((s) => s.name.length + s.descChars);
  const total = chars.reduce((a, b) => a + b, 0);
  const longest = skills[chars.indexOf(Math.max(...chars))];
  const over = longest && longest.descChars > 1536;
  console.log(`  ${over || total > 8000 ? 'WARN' : 'OK  '} listed set ${n(total)} chars (Codex budget 8,000); longest ${longest?.name} ${n(longest?.descChars ?? 0)} (Claude cap 1,536 per entry)`);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text edit, not a rewrite, so the rest of settings.json keeps its formatting.
export function jsonPluginsOff(text, names) {
  const off = Object.entries(JSON.parse(text).enabledPlugins ?? {}).filter(([k, v]) => v === true && names.includes(k.split('@')[0])).map(([k]) => k);
  for (const k of off) text = text.replace(new RegExp(`("${escapeRe(k)}"\\s*:\\s*)true`), '$1false');
  const now = JSON.parse(text).enabledPlugins ?? {};
  return { text, off, failed: off.filter((k) => now[k] !== false) };
}

// `enabled = true` under a matching [plugins."name@marketplace"] becomes false; a header with no enabled line gets one.
export function tomlPluginsOff(text, names) {
  const out = [];
  const off = [];
  let cur = null;
  const close = () => { if (cur && !cur.seen) { out.splice(cur.at + 1, 0, 'enabled = false'); off.push(cur.id); } cur = null; };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      close();
      const h = /^\s*\[plugins\.(["'])(([^"'@]+)@[^"']*)\1\]\s*$/.exec(line);
      if (h && names.includes(h[3])) cur = { id: h[2], at: out.length, seen: false };
    } else if (cur) {
      const m = /^(\s*enabled\s*=\s*)(true|false)(\s*(#.*)?)$/.exec(line);
      if (m) cur.seen = true;
      if (m?.[2] === 'true') { out.push(`${m[1]}false${m[3]}`); off.push(cur.id); continue; }
    }
    out.push(line);
  }
  close();
  return { text: out.join(text.includes('\r\n') ? '\r\n' : '\n'), off, failed: [] };
}

export function pluginsOff(names) {
  const files = [['Claude', join(home(), '.claude', 'settings.json'), jsonPluginsOff], ['Codex', join(home(), '.codex', 'config.toml'), tomlPluginsOff]];
  for (const [label, file, edit] of files) {
    if (!existsSync(file)) continue;
    try {
      const before = readFileSync(file, 'utf8');
      const r = edit(before, names);
      if (r.failed.length) throw new Error(r.failed.join(', '));
      if (r.text !== before) { backup(file); writeFileSync(file, r.text); }
      console.log(`  OK   ${label} plugins off: ${r.off.length ? `turned off ${r.off.join(', ')} in ${file}` : `none of ${names.join(', ')} enabled`}`);
    } catch {
      console.log(`  TODO ${label}: could not edit ${file} safely; set ${names.map((x) => `${x}@<marketplace>`).join(', ')} to ${label === 'Claude' ? '"enabledPlugins": false' : 'enabled = false under [plugins."<name>@<marketplace>"]'} by hand`);
    }
  }
}
