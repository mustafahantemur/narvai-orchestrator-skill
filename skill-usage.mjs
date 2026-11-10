// Skill kullanım sayımı: ~/.claude/projects altındaki konuşma kayıtlarında Skill aracı çağrılarını ve
// /komut kullanımlarını sayar, kurulu skill'lerle karşılaştırır. Hiçbir şey silmez.
// Kullanım: node skill-usage.mjs [--days 30]
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = homedir();
const daysArg = process.argv.indexOf('--days');
const days = daysArg > 0 ? Number(process.argv[daysArg + 1]) : null;
const since = days ? Date.now() - days * 86_400_000 : 0;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

function installed() {
  const names = new Set();
  const userSkills = join(home, '.claude', 'skills');
  if (existsSync(userSkills)) for (const d of readdirSync(userSkills)) if (existsSync(join(userSkills, d, 'SKILL.md'))) names.add(d);
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  const enabled = Object.entries(settings.enabledPlugins ?? {}).filter(([, on]) => on).map(([id]) => id.split('@'));
  for (const [plugin, market] of enabled) {
    const base = join(home, '.claude', 'plugins', 'cache', market, plugin);
    if (!existsSync(base)) continue;
    const version = readdirSync(base).sort().at(-1);
    const skills = join(base, version, 'skills');
    if (!existsSync(skills)) continue;
    for (const d of readdirSync(skills)) {
      if (existsSync(join(skills, d, 'SKILL.md'))) { names.add(`${plugin}:${d}`); continue; }
      for (const n of readdirSync(join(skills, d))) if (existsSync(join(skills, d, n, 'SKILL.md'))) names.add(`${plugin}:${n}`);
    }
  }
  return names;
}

const uses = new Map();
const note = (name, ts) => {
  const u = uses.get(name) ?? { count: 0, last: '' };
  u.count += 1;
  if (ts > u.last) u.last = ts;
  uses.set(name, u);
};

for (const file of walk(join(home, '.claude', 'projects'))) {
  if (statSync(file).mtimeMs < since) continue;
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"name":"Skill"') && !line.includes('<command-name>')) continue;
    const ts = /"timestamp":"([^"]+)"/.exec(line)?.[1] ?? '';
    if (since && ts && Date.parse(ts) < since) continue;
    for (const m of line.matchAll(/"name":"Skill","input":\{"skill":"([^"]+)"/g)) note(m[1], ts);
    for (const m of line.matchAll(/<command-name>\/?([\w:.-]+)<\/command-name>/g)) note(m[1], ts);
  }
}

const inst = installed();
const rows = [...inst].map((n) => ({ n, ...(uses.get(n) ?? { count: 0, last: '' }) }))
  .sort((a, b) => b.count - a.count || a.n.localeCompare(b.n));
const window = days ? `son ${days} gün` : 'bütün kayıtlar';
console.log(`Kurulu skill: ${inst.size} (${window})`);
console.log('\nKullanılanlar:');
for (const r of rows.filter((r) => r.count)) console.log(`  ${String(r.count).padStart(4)}  ${r.last.slice(0, 10)}  ${r.n}`);
const unused = rows.filter((r) => !r.count).map((r) => r.n);
console.log(`\nHiç kullanılmayan (${unused.length}):`);
console.log('  ' + unused.join(', '));
