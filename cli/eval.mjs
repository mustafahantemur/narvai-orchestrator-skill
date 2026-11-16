import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { cfg, git, HARNESS, home } from './ortak.mjs';

// Evals run on the user's Claude subscription login only, never on an API key or a cloud provider account.
const KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const WRITERS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const CONTEXT = /\bnarvai(\.mjs"?|\.cmd)?\s+context\b/;
const RULES_FILE = /project-rules\.md$|profiles[\\/][^\\/]+[\\/]rules\.md$/;
const SHELL_READ = /\b(?:cat|head|tail|sed|less|more|bat|type|Get-Content|gc)\b/;
const SKILL_IN_COMMAND = /([^\\/\s"']+)[\\/]SKILL\.md/gi;

function keyRisk(repos) {
  const found = KEY_VARS.filter((v) => process.env[v]).map((v) => `env ${v}`);
  const files = [join(home(), '.claude', 'settings.json'), join(home(), '.claude', 'settings.local.json')];
  for (const r of repos) files.push(join(r, '.claude', 'settings.json'), join(r, '.claude', 'settings.local.json'));
  for (const f of files) if (existsSync(f) && /apiKeyHelper|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY/.test(readFileSync(f, 'utf8'))) found.push(f);
  return found;
}

const linkedWorktree = (cwd) => {
  const own = git(['rev-parse', '--path-format=absolute', '--git-dir'], cwd);
  return Boolean(own) && own !== git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
};
const reset = (cwd) => { git(['reset', '--hard', '-q'], cwd); git(['clean', '-fdq'], cwd); };

// A skill counts as loaded when the Skill tool names it or its SKILL.md is read.
export const skillOf = (path) => /[\\/]([^\\/]+)[\\/]SKILL\.md$/i.exec(path ?? '')?.[1];

export function digest(events) {
  const run = { skills: [], tools: [], commands: [], writes: [], reads: [], denied: [], steps: [], hookContext: false, allText: '', text: '', cost: null, ms: null, turns: null, model: null, usage: null, error: null };
  const calls = new Map();
  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') { run.model = ev.model; run.apiKeySource = ev.apiKeySource ?? null; }
    if (ev.type === 'system' && ev.subtype === 'hook_response' && /narvai (?:context|session start):/.test(JSON.stringify(ev))) run.hookContext = true;
    if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) {
      if (c.type === 'text') run.allText += c.text + '\n';
      if (c.type !== 'tool_use') continue;
      const input = c.input ?? {};
      const path = input.file_path ?? input.notebook_path ?? '';
      const arg = input.command ?? input.skill ?? path ?? '';
      calls.set(c.id, { name: c.name, arg });
      run.tools.push(c.name);
      run.steps.push(`${c.name} ${String(arg || JSON.stringify(input)).replace(/\s+/g, ' ').slice(0, 220)}`);
      if (WRITERS.includes(c.name)) run.writes.push(path);
      if (c.name === 'Skill' && input.skill) run.skills.push(input.skill.split(':').at(-1));
      if (c.name === 'Read') run.reads.push(path);
      if (c.name === 'Read' && skillOf(path)) run.skills.push(skillOf(path));
      if (input.command) {
        run.commands.push({ id: c.id, text: input.command });
        // Agents often read a skill with cat or head instead of the Read tool.
        if (SHELL_READ.test(input.command)) for (const m of input.command.matchAll(SKILL_IN_COMMAND)) run.skills.push(m[1]);
      }
    }
    if (ev.type === 'user') for (const c of Array.isArray(ev.message?.content) ? ev.message.content : []) {
      if (c.type !== 'tool_result' || !c.is_error) continue;
      const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '');
      if (/hook/i.test(text)) run.denied.push({ id: c.tool_use_id, call: calls.get(c.tool_use_id), text: text.slice(0, 200) });
    }
    if (ev.type === 'result') {
      run.text = ev.result ?? ''; run.cost = ev.total_cost_usd ?? null; run.ms = ev.duration_ms ?? null; run.turns = ev.num_turns ?? null;
      const u = ev.usage ?? {};
      run.usage = { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 };
      if (ev.is_error) run.error = ev.subtype;
    }
  }
  run.skills = [...new Set(run.skills)];
  return run;
}

function runClaude(sc, cwd, transcript) {
  const line = ['claude -p --output-format stream-json --verbose --no-session-persistence', `--permission-mode ${sc.permissionMode}`, `--max-budget-usd ${Number(sc.maxBudgetUsd)}`, sc.model ? `--model ${sc.model}` : ''].join(' ');
  const env = { ...process.env };
  for (const v of KEY_VARS) delete env[v];
  return new Promise((done) => {
    const child = spawn(line, { cwd, shell: true, env });
    const events = [];
    let buf = '', stderr = '', error = null;
    const timer = setTimeout(() => { error = 'timeout'; child.kill(); }, sc.timeoutSec * 1000);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        let ev; try { ev = JSON.parse(buf.slice(0, i)); } catch { ev = null; }
        buf = buf.slice(i + 1);
        if (!ev) continue;
        events.push(ev);
        if (ev.type === 'system' && ev.subtype === 'init' && ev.apiKeySource && ev.apiKeySource !== 'none') { error = `api key in use (${ev.apiKeySource}), aborted`; child.kill(); }
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      writeFileSync(transcript, events.map((e) => JSON.stringify(e)).join('\n'));
      const run = digest(events);
      run.error = error ?? run.error ?? (run.cost === null ? `no result (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}` : null);
      done(run);
    });
    child.stdin.end(sc.prompt);
  });
}

// `tree` is what the scenario left behind: the changed paths and a way to ask whether a file holds a text.
export function judge(sc, run, cwd, tree) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const rx = (p) => new RegExp(p, 'i');
  const cmds = run.commands.map((c) => c.text);
  const blocked = new Set(run.denied.map((d) => d.id));
  const fullContext = cmds.some((c) => CONTEXT.test(c) && !/--hook/.test(c)) || run.reads.some((p) => RULES_FILE.test(p));
  add('repo context present', run.hookContext || fullContext);
  if (sc.fullContext) add('full rules read before the change', fullContext);
  for (const s of sc.skillsAll ?? []) add(`skill ${s}`, run.skills.includes(s));
  if (sc.skillsAny?.length) add(`any skill of ${sc.skillsAny.join('|')}`, sc.skillsAny.some((s) => run.skills.includes(s)), `loaded: ${run.skills.join(', ') || 'none'}`);
  for (const p of sc.commandsAll ?? []) add(`command /${p}/`, cmds.some((c) => rx(p).test(c)));
  if (sc.commandsAny?.length) add(`any command of ${sc.commandsAny.length}`, sc.commandsAny.some((p) => cmds.some((c) => rx(p).test(c))));
  if (sc.toolsAny?.length) add(`any tool of ${sc.toolsAny.join('|')}`, sc.toolsAny.some((t) => run.tools.some((x) => rx(t).test(x))));
  for (const t of sc.toolsNone ?? []) add(`no ${t}`, !run.tools.includes(t));
  const inRepo = run.writes.filter((p) => { const r = relative(cwd, resolve(cwd, p)); return r && !r.startsWith('..') && !isAbsolute(r); });
  if (sc.writesNone) add('no write inside the repo', !inRepo.length, inRepo.join(', '));
  // A command the hook refused did not run; the attempt is reported, the check passes.
  for (const b of sc.bashNone ?? []) { const hit = run.commands.find((c) => rx(b).test(c.text) && !blocked.has(c.id)); add(`no command /${b}/`, !hit, hit?.text.slice(0, 120) ?? ''); }
  for (const f of sc.filesAll ?? []) {
    if (f.contains) add(`${f.path} contains "${f.contains}"`, tree.contains(f.path, f.contains));
    if (f.notContains) add(`${f.path} does not contain "${f.notContains}"`, !tree.contains(f.path, f.notContains));
  }
  for (const p of sc.changedAll ?? []) add(`${p} was changed`, tree.changed.some((l) => l.trim().replace(/^\S+\s+/, '').replaceAll('"', '') === p));
  const seen = `${run.allText}\n${run.text}`;
  for (const p of sc.textAll ?? []) add(`text /${p}/`, rx(p).test(seen));
  if (sc.textAny?.length) add(`text any of ${sc.textAny.length}`, sc.textAny.some((p) => rx(p).test(seen)));
  if (sc.turnsMax) add(`at most ${sc.turnsMax} turns`, (run.turns ?? Infinity) <= sc.turnsMax, `${run.turns} turns`);
  const unnamed = run.skills.filter((s) => !seen.toLowerCase().includes(s.toLowerCase()));
  add('names the skills it loaded', unnamed.length === 0, unnamed.join(', '));
  if (run.error) add('run finished', false, run.error);
  return checks;
}

async function lane(list, cwd, dir, save) {
  const results = [];
  for (const s of list) {
    if (results.some((r) => r.error?.startsWith('api key'))) break;
    reset(cwd);
    for (const e of s.setup ?? []) {
      const p = join(cwd, e.file);
      const before = readFileSync(p, 'utf8');
      if (!before.includes(e.find)) throw new Error(`${s.id}: setup text not found in ${e.file}`);
      writeFileSync(p, before.replace(e.find, e.replace));
    }
    const run = await runClaude(s, cwd, join(dir, `${s.id}.jsonl`));
    const changed = git(['status', '--short'], cwd).split('\n').filter(Boolean);
    const contains = (p, text) => existsSync(join(cwd, p)) && readFileSync(join(cwd, p), 'utf8').includes(text);
    const facts = (s.filesAll ?? []).flatMap((x) => [x.contains, x.notContains].filter(Boolean).map((text) => ({ path: x.path, text, found: contains(x.path, text) })));
    const checks = judge(s, run, cwd, { changed, contains });
    const pass = checks.every((c) => c.ok);
    results.push({ id: s.id, repo: s.repo, why: s.why, prompt: s.prompt, pass, checks, changed, facts, ...run, commands: run.commands.map((c) => c.text) });
    save(results);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${s.id}  $${run.cost?.toFixed(2) ?? '?'}  ${Math.round((run.ms ?? 0) / 1000)}s  ${run.turns ?? '?'} turns  skills: ${run.skills.join(', ') || '-'}${run.denied.length ? `  hook refused ${run.denied.length}` : ''}`);
    for (const c of checks.filter((c) => !c.ok)) console.log(`     ✗ ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  }
  reset(cwd);
  return results;
}

// Scores saved transcripts again with the current scenarios and checks; what the files held is taken from the saved run.
export function rejudge(dir, spec, repos) {
  const saved = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')).results;
  return saved.filter((old) => existsSync(join(dir, `${old.id}.jsonl`)) && spec.scenarios.some((s) => s.id === old.id)).map((old) => {
    const sc = { ...spec.defaults, ...spec.scenarios.find((s) => s.id === old.id) };
    const events = readFileSync(join(dir, `${old.id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const run = { ...digest(events), error: old.error };
    const known = (p, text) => old.facts?.find((x) => x.path === p && x.text === text)?.found ?? old.checks.find((c) => c.name === `${p} contains "${text}"`)?.ok ?? false;
    const checks = judge(sc, run, repos[sc.repo], { changed: old.changed ?? [], contains: known });
    return { id: old.id, repo: old.repo, pass: checks.every((c) => c.ok), checks, skills: run.skills, turns: run.turns, ms: run.ms, cost: run.cost, usage: run.usage, denied: run.denied.length, commands: run.commands.map((c) => c.text), text: run.text };
  });
}

function report(rows) {
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  $${r.cost?.toFixed(2) ?? '?'}  ${Math.round((r.ms ?? 0) / 1000)}s  ${r.turns ?? '?'} turns  skills: ${r.skills.join(', ') || '-'}${r.denied ? `  hook refused ${r.denied}` : ''}`);
    for (const c of r.checks.filter((c) => !c.ok)) console.log(`     ✗ ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  }
  console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} pass`);
}

export default async function run(args) {
  const conf = cfg();
  const spec = JSON.parse(readFileSync(join(HARNESS, 'evals', 'scenarios.json'), 'utf8'));
  const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  if (opt('rejudge')) {
    const rows = rejudge(opt('rejudge'), spec, conf.evalRepos ?? {});
    report(rows);
    writeFileSync(join(opt('rejudge'), 'rejudged.json'), JSON.stringify({ at: new Date().toISOString(), results: rows }, null, 2));
    return;
  }
  const only = opt('only')?.split(',');
  const list = spec.scenarios.filter((s) => !only || only.includes(s.id)).map((s) => ({ ...spec.defaults, ...s, ...(opt('model') ? { model: opt('model') } : {}) }));
  const repos = conf.evalRepos ?? {};
  console.log(`${list.length} scenario(s), spend cap $${list.reduce((n, s) => n + s.maxBudgetUsd, 0).toFixed(2)} (--max-budget-usd per run)`);
  if (args.includes('--dry-run')) { for (const s of list) console.log(`  ${s.id}  [${s.repo} → ${repos[s.repo] ?? 'MISSING evalRepos'}]  "${s.prompt}"`); return; }
  const used = [...new Set(list.map((s) => s.repo))];
  for (const r of used) {
    if (!repos[r] || !existsSync(repos[r])) throw new Error(`evalRepos.${r} is not set in ~/.narvai/config.json`);
    if (!linkedWorktree(repos[r])) throw new Error(`evalRepos.${r} must be a linked git worktree (git worktree add --detach <dir>): scenarios edit files and the runner resets the tree between them`);
  }
  const risk = keyRisk(Object.values(repos));
  if (risk.length) { console.error(`refusing to run: an API key or provider account could be used (${risk.join(', ')}). Evals run on the subscription login only.`); process.exit(1); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(conf.storeRoot ?? join(home(), '.narvai'), 'dev-harness', 'evals', stamp);
  mkdirSync(dir, { recursive: true });
  // Each lane rewrites the results file after every scenario, so an interrupted run keeps what it finished.
  const done = {};
  const save = (r) => (rows) => { done[r] = rows; writeFileSync(join(dir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results: Object.values(done).flat() }, null, 2)); };
  const results = (await Promise.all(used.map((r) => lane(list.filter((s) => s.repo === r), repos[r], dir, save(r))))).flat();
  const total = results.reduce((n, r) => n + (r.cost ?? 0), 0);
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass, cost $${total.toFixed(2)}`);
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), total_cost_usd: total, results }, null, 2));
  console.log(`results and transcripts: ${dir}`);
}
