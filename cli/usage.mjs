import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { HARNESS, home as homeDir, readJson } from './ortak.mjs';

export function frontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!block) return out;
  const lines = block[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const parts = /^[>|][+-]?$/.test(kv[2]) ? [] : [kv[2]];
    while (/^\s+\S/.test(lines[i + 1] ?? '')) parts.push(lines[++i].trim());
    let v = parts.join(' ').trim();
    if (/^".*"$/s.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    else if (/^'.*'$/s.test(v)) v = v.slice(1, -1).replaceAll("''", "'");
    out[kv[1]] = v;
  }
  return out;
}

const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => join(p, e.name)) : []);
const hasSkill = (d) => existsSync(join(d, 'SKILL.md'));

function entryOf(dir, source, extra = {}, file = join(dir, 'SKILL.md')) {
  const fm = frontmatter(readFileSync(file, 'utf8'));
  const folder = dir.split(/[\\/]/).at(-1).replace(/\.md$/, '');
  const desc = [fm.description, fm.when_to_use].filter(Boolean).join(' ');
  return { id: folder, name: folder, fmName: fm.name, plugin: null, enabled: true, source, dir, chars: desc.length, descChars: (fm.description ?? '').length, hidden: fm['disable-model-invocation'] === 'true', visible: false, ...extra };
}

// The newest cached version of every plugin under <cache>/<market>/<plugin>/<version>.
export function cachedPlugins(cache, isEnabled) {
  const found = [];
  for (const market of dirs(cache)) {
    for (const plugin of dirs(market)) {
      const root = dirs(plugin).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (!root) continue;
      const name = plugin.split(/[\\/]/).at(-1), mk = market.split(/[\\/]/).at(-1);
      found.push({ id: `${name}@${mk}`, name, market: mk, root, enabled: isEnabled(`${name}@${mk}`) });
    }
  }
  return found;
}

export function claudePlugins(home = homeDir()) {
  const enabled = readJson(join(home, '.claude', 'settings.json'), {}).enabledPlugins ?? {};
  return cachedPlugins(join(home, '.claude', 'plugins', 'cache'), (id) => enabled[id] === true);
}

const manifest = (root) => readJson(join(root, '.claude-plugin', 'plugin.json'), null) ?? readJson(join(root, 'plugin.json'), {});

function pluginSkillDirs(root) {
  return [manifest(root).skills ?? './skills'].flat().flatMap((p) => {
    const abs = join(root, p);
    return hasSkill(abs) ? [abs] : dirs(abs).filter(hasSkill);
  });
}

function pluginCommandFiles(root) {
  return [manifest(root).commands ?? './commands'].flat().flatMap((p) => {
    const abs = join(root, p);
    return existsSync(abs) ? readdirSync(abs).filter((f) => f.endsWith('.md')).map((f) => join(abs, f)) : [];
  });
}

// Every skill reachable on this machine: own, vendored, user dir (Claude), plugin caches.
export function skillInventory(home = homeDir()) {
  const entries = [];
  for (const [rel, source] of [['skills', 'hub'], [join('third-party', 'skills'), 'vendored']]) {
    for (const d of dirs(join(HARNESS, rel)).filter(hasSkill)) entries.push(entryOf(d, source));
  }
  const hubByReal = new Map(entries.map((e) => [realpathSync(e.dir), e]));
  for (const d of dirs(join(home, '.claude', 'skills')).filter(hasSkill)) {
    const hub = hubByReal.get(realpathSync(d));
    if (hub) hub.visible = true;
    else entries.push(entryOf(d, 'user', { visible: true }));
  }
  for (const p of claudePlugins(home)) {
    for (const d of pluginSkillDirs(p.root)) {
      const e = entryOf(d, 'plugin', { plugin: p.name, enabled: p.enabled });
      e.id = `${p.name}:${e.name}`;
      e.visible = p.enabled && !e.hidden;
      entries.push(e);
    }
    for (const f of pluginCommandFiles(p.root)) {
      const e = entryOf(f, 'plugin', { plugin: p.name, enabled: p.enabled, command: true }, f);
      e.id = `${p.name}:${e.name}`;
      e.visible = p.enabled && !e.hidden;
      if (!entries.some((x) => x.id === e.id)) entries.push(e);
    }
  }
  return entries;
}

export function indexOf(entries) {
  const byId = new Map(), byName = new Map();
  for (const e of entries) {
    if (!byId.has(e.id)) byId.set(e.id, e);
    if (!e.command) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  }
  return { byId, byName };
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

async function transcriptUses(home, since, isKnown) {
  const uses = new Map();
  const note = (name, ts) => {
    const u = uses.get(name) ?? { count: 0, last: '' };
    u.count += 1;
    if (ts > u.last) u.last = ts;
    uses.set(name, u);
  };
  const root = join(home, '.claude', 'projects');
  if (!existsSync(root)) return uses;
  for (const file of walk(root)) {
    if (statSync(file).mtimeMs < since) continue;
    const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"name":"Skill"') && !line.includes('<command-name>')) continue;
      const ts = /"timestamp":"([^"]+)"/.exec(line)?.[1] ?? '';
      if (since && ts && Date.parse(ts) < since) continue;
      for (const m of line.matchAll(/"name":"Skill","input":\{"skill":"([^"]+)"/g)) note(m[1], ts);
      for (const m of line.matchAll(/<command-name>\/?([\w:.-]+)<\/command-name>/g)) if (isKnown(m[1])) note(m[1], ts);
    }
  }
  return uses;
}

const day = (v) => (typeof v === 'number' ? new Date(v).toISOString() : v).slice(0, 10);
const num = (v, w) => (v ? String(v) : '-').padStart(w);

export default async function run(args = []) {
  const home = homeDir();
  const daysArg = args.indexOf('--days');
  const days = daysArg >= 0 ? Number(args[daysArg + 1]) : null;
  const since = days ? Date.now() - days * 86_400_000 : 0;

  const entries = skillInventory(home);
  const idx = indexOf(entries);
  const known = (n) => idx.byId.has(n) || idx.byName.has(n);
  const transcripts = await transcriptUses(home, since, known);
  const counter = readJson(join(home, '.claude.json'), {}).skillUsage ?? {};

  const rows = entries.map((e) => {
    const t = transcripts.get(e.id) ?? transcripts.get(e.name);
    const c = counter[e.id] ?? counter[e.name];
    return { name: e.id + (e.source === 'plugin' ? (e.enabled ? '' : ' [plugin off]') : e.visible ? '' : ' [hub only]') + (e.hidden ? ' [hidden]' : ''), listed: e.visible, chars: e.hidden ? 0 : e.chars, tr: t?.count ?? 0, cl: c?.usageCount ?? 0, last: [t?.last ?? '', c ? day(c.lastUsedAt) : ''].sort().at(-1).slice(0, 10) };
  });
  const gone = [...new Set([...transcripts.keys(), ...Object.keys(counter)])].filter((n) => !known(n))
    .map((n) => ({ name: n, chars: 0, tr: transcripts.get(n)?.count ?? 0, cl: counter[n]?.usageCount ?? 0, last: [transcripts.get(n)?.last ?? '', counter[n] ? day(counter[n].lastUsedAt) : ''].sort().at(-1).slice(0, 10) }));

  const line = (r) => `${num(r.tr, 5)} ${num(r.cl, 5)}  ${(r.last || '-').padEnd(10)} ${num(r.chars, 6)}  ${r.name}`;
  const byUse = (a, b) => b.tr + b.cl - (a.tr + a.cl) || a.name.localeCompare(b.name);
  const used = rows.filter((r) => r.tr || r.cl).sort(byUse);
  const unused = rows.filter((r) => !r.tr && !r.cl && r.listed).sort((a, b) => b.chars - a.chars || a.name.localeCompare(b.name));
  const listed = entries.filter((e) => e.visible && !e.hidden);
  const hubOnly = entries.filter((e) => e.source !== 'plugin' && !e.visible).length, off = entries.filter((e) => !e.enabled).length;
  console.log(`skills: ${entries.length} found; listed to Claude: ${listed.length} (${listed.reduce((s, e) => s + e.chars, 0)} description chars); hub only: ${hubOnly}; in disabled plugins: ${off}; transcripts: ${days ? `last ${days} days` : 'all'}; Claude counter: all time`);
  console.log('   tr    cl  last        chars  skill   (tr = transcripts, cl = Claude counter, chars = description + when_to_use)');
  for (const r of used) console.log(line(r));
  console.log(`unused: ${unused.length} skills, ${unused.reduce((s, r) => s + r.chars, 0)} chars${args.includes('--all') ? '' : '; largest 12 (--all lists every one)'}`);
  for (const r of args.includes('--all') ? unused : unused.slice(0, 12)) console.log(line(r));
  console.log(`used but not installed: ${gone.length} (renamed, removed or built in)`);
  for (const r of gone.sort(byUse)) console.log(line(r));
}
