import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { cfg, cfgPath, HARNESS, home, readJson, sameDir, skillTargets, tilde, which } from './ortak.mjs';
import { graphRows } from './graph.mjs';
import runSync from './sync.mjs';
import { cachedPlugins, claudePlugins, frontmatter, indexOf, skillInventory } from './usage.mjs';

export const LIMITS = { claudeEntry: 1536, specDescription: 1024, codexTotal: 8000, claudeMin: [2, 1, 277], ruleLines: 100, profileRuleLines: 25 };
const ROUTER_EVENTS = ['SessionStart', 'SubagentStart'];

const R = (level, text, fix = false) => ({ level, text, fix });
const ok = (t) => R('OK', t);
const warn = (t, fix) => R('WARN', t, fix);
const fail = (t, fix) => R('FAIL', t, fix);
const short = (p) => p.replace(home(), '~');
const n = (v) => v.toLocaleString('en-US');
const list = (xs, max = 8) => xs.slice(0, max).join(', ') + (xs.length > max ? ` +${xs.length - max} more` : '');

// ---- skill references (pure) ----

export function resolveRef(token, idx) {
  const hit = idx.byId.get(token);
  if (hit) return hit.enabled ? { status: 'ok' } : { status: 'off', hint: `plugin ${hit.plugin} is disabled` };
  const same = idx.byName.get(token.split(':').at(-1)) ?? [];
  const ids = same.filter((e) => e.enabled).map((e) => e.id).join(', ');
  if (!same.length) return { status: 'missing' };
  if (!ids) return { status: 'off', hint: `plugin ${same[0].plugin} is disabled` };
  return { status: token.includes(':') ? 'wrong-prefix' : 'prefix', hint: ids };
}

const NAME = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const PREFIXED = new RegExp(`^${NAME}:${NAME}$`);

// Backticked names that are, or look like, skills. `ignore` holds file stems, `plugins` plugin names.
export function findRefs(text, idx, { ignore = new Set(), plugins = new Set(), used = new Set() } = {}) {
  const found = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    for (const [, token] of lineText.matchAll(/`([a-z][a-z0-9:-]*)`/g)) {
      const r = resolveRef(token, idx);
      if (r.status === 'ok') continue;
      const skillLine = /skill/i.test(lineText);
      const looksLikeSkill = token.includes(':') ? PREFIXED.test(token) && (plugins.has(token.split(':')[0]) || skillLine) : token.includes('-') && skillLine && !plugins.has(token) && !ignore.has(token);
      const seen = r.status === 'missing' && /[-:]/.test(token) && used.has(token);
      if (r.status === 'missing' && !looksLikeSkill && !seen) continue;
      found.push({ token, line: i + 1, seen, ...r });
    }
  });
  return found;
}

const REF_MESSAGE = {
  missing: (r) => `not installed anywhere${r.seen ? '; the Claude counter has seen it (built in, renamed or removed)' : ''}`,
  'wrong-prefix': (r) => `wrong prefix, installed as ${r.hint}`,
  prefix: (r) => `bare name, installed only as ${r.hint}`,
  off: (r) => r.hint,
};

export function groupRefs(findings) {
  const groups = new Map();
  for (const f of findings) {
    const g = groups.get(`${f.status}|${f.token}`) ?? { ...f, where: [], strict: false };
    g.where.push(f.where);
    g.strict ||= f.strict;
    groups.set(`${f.status}|${f.token}`, g);
  }
  return [...groups.values()].map((g) => R(g.strict && g.status === 'missing' ? 'FAIL' : 'WARN', `skill ref ${g.token}: ${REF_MESSAGE[g.status](g)} (${g.where[0]}${g.where.length > 1 ? ` +${g.where.length - 1}` : ''})`));
}

// ---- sizes (pure) ----

export function sizeFindings(entries) {
  const total = entries.reduce((s, e) => s + e.chars, 0);
  const longest = entries.reduce((m, e) => (e.chars > (m?.chars ?? -1) ? e : m), null);
  return {
    count: entries.length, total, longest,
    overClaude: entries.filter((e) => e.chars > LIMITS.claudeEntry),
    overSpec: entries.filter((e) => e.descChars > LIMITS.specDescription),
    overCodex: total > LIMITS.codexTotal,
  };
}

export const versionAtLeast = (text, min) => {
  const v = /(\d+)\.(\d+)\.(\d+)/.exec(text)?.slice(1).map(Number);
  return v ? (v[0] - min[0] || v[1] - min[1] || v[2] - min[2]) >= 0 : null;
};

export function hookEvents(root) {
  const found = new Set();
  const add = (h) => Object.keys(h?.hooks ?? {}).forEach((e) => found.add(e));
  add(readJson(join(root, 'hooks', 'hooks.json'), null));
  for (const m of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json']) {
    const h = readJson(join(root, m), {}).hooks;
    if (typeof h === 'string') add(readJson(join(root, h), null));
    else if (h) add({ hooks: h });
  }
  return found;
}

export const missingHookFiles = (commands) => [...new Set(commands.flatMap((c) => c.match(/(?<![\w}$.-])(?:[A-Za-z]:[\\/]|\/)[^\s"'`|;&<>]+\.(?:mjs|cjs|js|sh|ps1|cmd|bat|exe|py)\b/g) ?? []))].filter((f) => !existsSync(f));

export function codexEnabledPlugins(toml) {
  const on = new Set();
  let id = null;
  for (const line of toml.split(/\r?\n/)) {
    const head = /^\[plugins\."([^"]+)"\]/.exec(line);
    if (head) id = head[1];
    else if (/^\[/.test(line)) id = null;
    else if (id && /^enabled\s*=\s*true/.test(line)) on.add(id);
  }
  return on;
}

// ---- inputs ----

const claudeSettings = () => join(home(), '.claude', 'settings.json');
const codexHooks = () => join(home(), '.codex', 'hooks.json');
const hookCommands = (file) => Object.values(readJson(file, {}).hooks ?? {}).flat().flatMap((e) => (e.hooks ?? []).map((x) => x.command ?? ''));
const mdFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => join(e.parentPath, e.name)) : []);
const rel = (p) => p.slice(HARNESS.length + 1).replaceAll('\\', '/');

function listedNames() {
  const routes = readJson(join(HARNESS, 'registry', 'routes.json'), null);
  const profiles = profileFiles().flatMap((f) => readJson(f, {}).skills ?? []);
  return { routes, names: [...new Set([...(routes?.listed ?? []), ...profiles])] };
}

const profileFiles = () => (existsSync(join(HARNESS, 'profiles')) ? readdirSync(join(HARNESS, 'profiles')).map((d) => join(HARNESS, 'profiles', d, 'profile.json')).filter(existsSync) : []);

function pick(name, idx) {
  return idx.byId.get(name) ?? idx.byName.get(name.split(':').at(-1))?.find((e) => e.enabled);
}

// ---- checks ----

function installation() {
  const conf = cfg();
  const rows = [];
  const chk = (okay, what, hint = '', fix = false) => rows.push(okay === true ? ok(what) : okay === null ? warn(`${what}${hint && `  (${hint})`}`, fix) : fail(`${what}${hint && `  (${hint})`}`, fix));
  const [major, minor] = process.versions.node.split('.').map(Number);
  chk(major >= 22 || (major === 20 && minor >= 17), `node ${process.versions.node}`, 'needs 20.17+ or 22+');
  chk(which('git'), 'git');
  chk(existsSync(cfgPath()), `config ${short(cfgPath())}`, 'run install');
  const store = conf.storeRoot && tilde(conf.storeRoot);
  chk(Boolean(store && existsSync(store)), `store ${store ?? '-'}`);
  if (store && existsSync(join(store, 'map.json'))) {
    const map = readJson(join(store, 'map.json'), {});
    const gone = Object.keys(map).filter((r) => !existsSync(r));
    chk(gone.length ? null : true, `map.json: ${Object.keys(map).length} repos`, gone.length ? `${gone.length} paths no longer exist: ${gone.slice(0, 3).join(', ')}` : '');
  }
  const src = 'rules/core.md';
  const claudeMd = join(home(), '.claude', 'CLAUDE.md');
  chk(existsSync(claudeMd) && readFileSync(claudeMd, 'utf8').includes(`GENERATED by narvai.mjs sync from ${src}`), `Claude CLAUDE.md generated from ${src}`, 'run sync --adopt', true);
  return rows;
}

function listedLinks(idx) {
  const { names } = listedNames();
  const want = [...new Set(['narvai-orchestrator', ...names])].map((x) => idx.byId.get(x)).filter((e) => e && e.source !== 'plugin');
  return skillTargets().filter((d) => /[\\/]\.(claude|agents)[\\/]/.test(d)).map((dir) => {
    const missing = want.filter((e) => !sameDir(e.dir, join(dir, e.name))).map((e) => e.name);
    return missing.length ? warn(`listed skills linked in ${short(dir)}: ${want.length - missing.length}/${want.length}, missing ${list(missing)}`, true) : ok(`listed skills linked in ${short(dir)}: ${want.length}/${want.length}`);
  });
}

function hooks() {
  const rows = [];
  const guard = existsSync(join(HARNESS, 'hooks', 'guard.mjs'));
  const wanted = guard ? [['guard.mjs', /[\\/]guard\.mjs/]] : ['narvai-guard.mjs', 'store-context.mjs', 'ua-auto-update.mjs'].filter((f) => existsSync(join(HARNESS, 'hooks', f))).map((f) => [f, new RegExp(f.replace('.', '\\.'))]);
  if (!guard) rows.push(warn('hooks/guard.mjs does not exist yet; checking the old hook files'));
  const claude = hookCommands(claudeSettings());
  for (const [f, re] of wanted) rows.push(claude.some((c) => re.test(c)) ? ok(`Claude hook ${f} registered`) : fail(`Claude hook ${f} not registered  (run sync)`, true));
  if (claude.some((c) => c.includes('ai-store-context'))) rows.push(warn('old PowerShell store hook still registered  (run sync)', true));
  if (guard && existsSync(join(home(), '.codex'))) {
    const codex = hookCommands(codexHooks());
    rows.push(codex.some((c) => /[\\/]guard\.mjs/.test(c)) ? ok('Codex hook guard.mjs registered') : warn('Codex hook guard.mjs not registered  (run sync)', true));
  }
  const gone = missingHookFiles([...claude, ...hookCommands(codexHooks())]);
  rows.push(gone.length ? fail(`hooks point at files that do not exist: ${list(gone)}`, true) : ok('every hook command points at an existing file'));
  return rows;
}

function codexTrust() {
  const file = codexHooks();
  const cmds = readJson(file, {}).hooks ?? {};
  const mine = Object.entries(cmds).flatMap(([event, groups]) => groups.flatMap((g, gi) => (g.hooks ?? []).map((h, hi) => [event, gi, hi, h.command ?? '']))).filter((x) => /[\\/]guard\.mjs/.test(x[3]));
  if (!mine.length) return [];
  const toml = existsSync(join(home(), '.codex', 'config.toml')) ? readFileSync(join(home(), '.codex', 'config.toml'), 'utf8') : '';
  const trusted = new Set([...toml.matchAll(/^\[hooks\.state\.'([^']+)'\]\s*\r?\n(?:(?!\[)[^\n]*\n)*?trusted_hash/gm)].map((m) => m[1].replaceAll('\\', '/').toLowerCase()));
  const here = file.replaceAll('\\', '/').toLowerCase();
  const untrusted = mine.filter(([event, g, h]) => !trusted.has(`${here}:${event.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}:${g}:${h}`)).map((x) => x[0]);
  return [untrusted.length ? warn(`Codex has not trusted the narvai guard for ${untrusted.join(', ')}  (open /hooks in Codex and trust it; the hash itself is not verified)`) : ok('Codex trusts the narvai guard entries (hash not verified)')];
}

function skillRefs(idx) {
  const files = [...mdFiles(join(HARNESS, 'rules')), ...mdFiles(join(HARNESS, 'skills')), ...mdFiles(join(HARNESS, 'agents')), ...profileFiles().map((f) => join(f, '..', 'rules.md')).filter(existsSync)];
  const own = join(home(), '.narvai', 'rules.md');
  if (existsSync(own)) files.push(own);
  const ctx = { ignore: new Set(files.map((f) => basename(f).replace(/\.md$/, ''))), plugins: new Set(claudePlugins().map((p) => p.name)), used: new Set(Object.keys(readJson(join(home(), '.claude.json'), {}).skillUsage ?? {})) };
  const findings = [];
  for (const f of files) for (const x of findRefs(readFileSync(f, 'utf8'), idx, ctx)) findings.push({ ...x, where: `${f.startsWith(HARNESS) ? rel(f) : short(f)}:${x.line}`, strict: false });
  const strict = (name, where) => {
    if (name.startsWith('@')) return;
    const r = resolveRef(name, idx);
    if (r.status !== 'ok') findings.push({ token: name, ...r, seen: false, where, strict: true });
  };
  const routes = readJson(join(HARNESS, 'registry', 'routes.json'), null);
  routes?.listed?.forEach((s) => strict(s, 'registry/routes.json listed'));
  routes?.routes?.forEach((r) => r.skills?.forEach((s) => strict(s, `registry/routes.json route ${r.id}`)));
  profileFiles().forEach((f) => readJson(f, {}).skills?.forEach((s) => strict(s, `${rel(f)} skills`)));
  for (const f of mdFiles(join(HARNESS, 'agents'))) frontmatter(readFileSync(f, 'utf8')).skills?.split(/[,\s]+/).filter(Boolean).forEach((s) => strict(s, `${rel(f)} skills`));
  const rows = groupRefs(findings);
  const missingRoutes = routes ? [] : [warn('registry/routes.json not found; routes were not checked')];
  return [...missingRoutes, ...(rows.length ? rows : [ok(`skill references: ${files.length} files, routes and profiles all resolve`)])];
}

function registry(idx) {
  const file = join(HARNESS, 'registry', 'skills.json');
  const reg = readJson(file, null);
  if (!reg) return [warn('registry/skills.json not found  (run sync)', true)];
  const list = Array.isArray(reg) ? reg : Array.isArray(reg.skills) ? reg.skills : Object.entries(reg.skills ?? reg).map(([id, v]) => ({ id, ...v }));
  const names = new Set(list.flatMap((s) => [s.id, s.name]).filter(Boolean).map((x) => x.split('/').at(-1)));
  const missing = [...idx.byId.values()].filter((e) => e.source === 'hub' || e.source === 'vendored').filter((e) => !names.has(e.name)).map((e) => e.name);
  return [missing.length ? warn(`skills on disk but not in registry/skills.json: ${list(missing)}  (run sync)`, true) : ok(`registry/skills.json covers every skill on disk (${list.length} entries)`)];
}

function listedSize(idx) {
  const { routes, names } = listedNames();
  if (!routes?.listed) return [warn('registry/routes.json has no "listed"; the listed set was not measured')];
  const entries = names.map((x) => pick(x, idx)).filter(Boolean);
  const s = sizeFindings(entries);
  const rows = [(s.overClaude.length ? fail : s.overCodex || s.overSpec.length ? warn : ok)(`listed set: ${s.count} skills, ${n(s.total)} description chars (Codex budget ${n(LIMITS.codexTotal)}), longest ${s.longest?.id} ${s.longest?.chars} (Claude cap ${n(LIMITS.claudeEntry)})`)];
  if (s.overClaude.length) rows.push(fail(`over Claude's ${n(LIMITS.claudeEntry)}-char cap: ${s.overClaude.map((e) => e.id).join(', ')}`));
  if (s.overSpec.length) rows.push(warn(`description over ${n(LIMITS.specDescription)} chars: ${s.overSpec.map((e) => e.id).join(', ')}`));
  for (const [label, dir] of [['Claude', join(home(), '.claude', 'skills')], ['Codex', join(home(), '.agents', 'skills')]]) {
    if (!existsSync(dir)) continue;
    const linked = readdirSync(dir).map((x) => idx.byId.get(x)).filter((e) => e && existsSync(join(dir, e.name, 'SKILL.md')));
    const total = linked.reduce((sum, e) => sum + e.chars, 0);
    const text = `linked now for ${label}: ${linked.length} skills, ${n(total)} description chars`;
    rows.push(label === 'Codex' && total > LIMITS.codexTotal ? warn(`${text}  (over ${n(LIMITS.codexTotal)}; Codex shortens or drops the rest)`) : ok(text));
  }
  const bad = [...idx.byId.values()].filter((e) => e.source !== 'plugin' && e.fmName !== undefined && e.fmName !== e.name).map((e) => e.name);
  if (bad.length) rows.push(warn(`skill name differs from its folder: ${list(bad)}`));
  return rows;
}

function ruleFiles() {
  const rows = [];
  for (const f of [join(home(), '.claude', 'CLAUDE.md'), join(home(), '.codex', 'AGENTS.md')]) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n').length - 1;
    const msg = `${short(f)}: ${lines} lines, ${n(text.length)} chars (target under ${LIMITS.ruleLines} lines)`;
    rows.push(lines > 200 ? fail(msg) : lines > LIMITS.ruleLines ? warn(msg) : ok(msg));
  }
  for (const f of profileFiles().map((p) => join(p, '..', 'rules.md')).filter(existsSync)) {
    const lines = readFileSync(f, 'utf8').trimEnd().split('\n').length;
    rows.push(lines > LIMITS.profileRuleLines ? warn(`${rel(f)}: ${lines} lines (limit ${LIMITS.profileRuleLines})`) : ok(`${rel(f)}: ${lines} lines`));
  }
  return rows;
}

function drift() {
  const tmp = mkdtempSync(join(tmpdir(), 'narvai-doctor-'));
  try {
    const own = join(home(), '.narvai');
    cpSync(own, join(tmp, '.narvai'), { recursive: true, dereference: true, filter: (p) => basename(p) !== 'backups' });
    const targets = ['.claude/CLAUDE.md', '.codex/AGENTS.md', '.gemini/config/GEMINI.md', '.pi/agent/AGENTS.md'];
    for (const t of targets) if (existsSync(join(home(), t, '..'))) mkdirSync(join(tmp, t, '..'), { recursive: true });
    try {
      execFileSync(process.execPath, [join(HARNESS, 'narvai.mjs'), 'sync'], { env: { ...process.env, NARVAI_HOME: tmp }, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
    } catch (e) {
      return [warn(`could not render the expected files: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`)];
    }
    const agents = [['.claude/agents', /^narvai-.*\.md$/], ['.codex/agents', /^narvai-.*\.toml$/]].flatMap(([d, re]) => (existsSync(join(tmp, d)) ? readdirSync(join(tmp, d)).filter((f) => re.test(f)).map((f) => `${d}/${f}`) : []));
    const rows = [];
    let same = 0;
    for (const t of [...targets, ...agents]) {
      if (!existsSync(join(tmp, t))) continue;
      const real = join(home(), t);
      const want = readFileSync(join(tmp, t), 'utf8');
      if (!existsSync(real)) rows.push(warn(`generated file missing: ${short(real)}  (run sync)`, true));
      else if (readFileSync(real, 'utf8') === want) same += 1;
      else rows.push(warn(`${short(real)} differs from its sources${/GENERATED by/.test(readFileSync(real, 'utf8')) ? '' : ' and was not generated by narvai'}  (run sync${/GENERATED by/.test(readFileSync(real, 'utf8')) ? '' : ' --adopt'})`, true));
    }
    return rows.length ? rows : [ok(`generated files match their sources (${same})`)];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function injectors() {
  const codexToml = existsSync(join(home(), '.codex', 'config.toml')) ? readFileSync(join(home(), '.codex', 'config.toml'), 'utf8') : '';
  const sets = [['Claude', claudePlugins()], ['Codex', cachedPlugins(join(home(), '.codex', 'plugins', 'cache'), (id) => codexEnabledPlugins(codexToml).has(id))]];
  const by = new Map();
  for (const [harness, plugins] of sets) {
    for (const p of plugins.filter((x) => x.enabled)) {
      const events = ROUTER_EVENTS.filter((e) => hookEvents(p.root).has(e));
      if (!events.length) continue;
      const skillsDir = join(p.root, 'skills');
      const router = existsSync(join(skillsDir, `using-${p.name}`)) && `using-${p.name}`;
      const cur = by.get(p.name) ?? { events: new Set(), harness: [], router: '' };
      events.forEach((e) => cur.events.add(e));
      cur.harness.push(harness);
      cur.router ||= router || '';
      by.set(p.name, cur);
    }
  }
  const rows = [...by].map(([name, c]) => warn(`plugin ${name} adds text at ${[...c.events].join(' and ')} (${c.harness.join(', ')}); size not measured`));
  const routers = [...by].filter(([, c]) => c.router).map(([name, c]) => `${name} (${c.router}, ${c.harness.join(', ')})`);
  rows.push(routers.length ? warn(`more than one router active: narvai-orchestrator plus ${routers.join(', ')}`) : ok('one router: narvai-orchestrator'));
  if (!by.size) rows.unshift(ok('no plugin adds text at session or subagent start'));
  return rows;
}

function vendored() {
  const tp = readJson(join(HARNESS, 'third-party.json'), null);
  if (!tp) return [warn('third-party.json not found')];
  const sources = tp.sources ?? [];
  const dir = join(HARNESS, 'third-party', 'skills');
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'SKILL.md'))) : [];
  const owned = new Set(sources.flatMap((s) => s.skills ?? []));
  const orphan = onDisk.filter((d) => !owned.has(d));
  const absent = sources.filter((s) => !s.manual).flatMap((s) => s.skills ?? []).filter((d) => !onDisk.includes(d));
  const live = sources.filter((s) => !s.manual);
  const noCommit = live.filter((s) => !s.commit || s.commit === 'unknown').map((s) => s.repo.slice(0, 40));
  const noLicense = sources.filter((s) => !s.license).map((s) => s.repo.slice(0, 40));
  const rows = [];
  rows.push(orphan.length ? warn(`vendored skills with no source recorded: ${list(orphan)}`) : ok(`vendored skills: ${onDisk.length} on disk, each has a source in third-party.json`));
  if (absent.length) rows.push(fail(`third-party.json lists skills missing from third-party/skills: ${list(absent)}`));
  rows.push(noCommit.length ? warn(`no pinned commit: ${list(noCommit)}`) : ok('every vendored source is pinned to a commit'));
  rows.push(noLicense.length ? warn(`no license recorded: ${list(noLicense)}`) : ok('every source records its license'));
  return rows;
}

function tools() {
  const tp = readJson(join(HARNESS, 'third-party.json'), {});
  const rows = [];
  const seen = new Set();
  const need = (bin, why, level) => {
    if (seen.has(bin)) return;
    seen.add(bin);
    rows.push(which(bin) ? ok(`${why} ${bin}`) : (level === 'fail' ? fail : warn)(`${why} ${bin} not on PATH`));
  };
  const files = profileFiles();
  if (!files.length) rows.push(warn('profiles/ has no profile.json; LSP binaries and check tools were not verified'));
  for (const f of files) {
    const p = readJson(f, {});
    if (p.lsp?.server) need(p.lsp.server, `LSP (${p.name})`);
    for (const c of p.checks ?? []) if (c.run) need(c.run.split(/\s+/)[0], `check tool (${p.name})`);
  }
  for (const t of tp.tools?.recommended ?? []) need(t, 'tool');
  for (const t of tp.tools?.heavy ?? []) need(t, 'tool (Heavy Mode)');
  return rows;
}

function versions() {
  const ver = (cmd) => { try { return execSync(`${cmd} --version`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; } catch { return null; } };
  const claude = ver('claude'), codex = ver('codex');
  const need = LIMITS.claudeMin.join('.');
  return [
    claude == null ? warn('claude not found on PATH') : versionAtLeast(claude, LIMITS.claudeMin) ? ok(`Claude Code ${claude}`) : warn(`Claude Code ${claude}  (AGENTS.md support needs ${need}+)`),
    codex == null ? warn('codex not found on PATH') : ok(`Codex ${codex}`),
  ];
}

function graphs() {
  let rows;
  try { rows = graphRows(); } catch { return []; }
  return rows.filter((r) => r.commits.length).map((r) => {
    const stale = r.states.find((s) => !s.startsWith('current'));
    return stale ? warn(`graph ${r.repo}: ${stale}  (narvai graph build --only ${r.repo})`) : ok(`graph ${r.repo}: ${r.states[0]}`);
  });
}

function pipeline(idx) {
  return [
    ['installation', installation], ['listed links', () => listedLinks(idx)], ['hooks', hooks], ['codex trust', codexTrust],
    ['skill refs', () => skillRefs(idx)], ['registry', () => registry(idx)], ['sizes', () => listedSize(idx)], ['rule files', ruleFiles],
    ['injectors', injectors], ['vendored', vendored], ['tools', tools], ['versions', versions], ['graphs', graphs], ['drift', drift],
  ];
}

function collect() {
  const idx = indexOf(skillInventory());
  return pipeline(idx).flatMap(([name, fn]) => {
    try { return fn(); } catch (e) { return [warn(`check ${name} failed: ${String(e.message).split('\n')[0]}`)]; }
  });
}

export default async function run(args = []) {
  let rows = collect();
  if (args.includes('--fix') && rows.some((r) => r.fix && r.level !== 'OK')) {
    console.log('narvai doctor --fix: running sync');
    await runSync([]);
    rows = collect();
  }
  console.log('narvai doctor');
  for (const r of rows) console.log(`  ${r.level.padEnd(4)} ${r.text}`);
  const count = (l) => rows.filter((r) => r.level === l).length;
  console.log(`${count('OK')} OK, ${count('WARN')} WARN, ${count('FAIL')} FAIL`);
  if (count('FAIL')) process.exitCode = 1;
}
