import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cfg, HARNESS, home } from './ortak.mjs';

// Evals run on the user's Claude subscription login only, never on an API key or a cloud provider account.
const KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

function keyRisk(repos) {
  const found = KEY_VARS.filter((v) => process.env[v]).map((v) => `env ${v}`);
  const files = [join(home(), '.claude', 'settings.json'), join(home(), '.claude', 'settings.local.json')];
  for (const r of repos) files.push(join(r, '.claude', 'settings.json'), join(r, '.claude', 'settings.local.json'));
  for (const f of files) if (existsSync(f) && /apiKeyHelper|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY/.test(readFileSync(f, 'utf8'))) found.push(f);
  return found;
}

function runClaude(prompt, cwd, sc) {
  const line = `claude -p --output-format stream-json --verbose --no-session-persistence --permission-mode ${sc.permissionMode} --max-budget-usd ${Number(sc.maxBudgetUsd)}`;
  const env = { ...process.env };
  for (const v of KEY_VARS) delete env[v];
  return new Promise((done) => {
    const child = spawn(line, { cwd, shell: true, env });
    const run = { skills: [], tools: [], commands: [], writes: [], allText: '', text: '', cost: null, ms: null, turns: null, model: null, error: null };
    let buf = '';
    const timer = setTimeout(() => { run.error = 'timeout'; child.kill(); }, sc.timeoutSec * 1000);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') {
          run.model = ev.model;
          run.apiKeySource = ev.apiKeySource ?? null;
          if (run.apiKeySource && run.apiKeySource !== 'none') { run.error = `api key in use (${run.apiKeySource}), aborted`; child.kill(); }
        }
        if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) {
          if (c.type === 'text') run.allText += c.text + '\n';
          if (c.type !== 'tool_use') continue;
          run.tools.push(c.name);
          if (['Edit', 'Write', 'NotebookEdit'].includes(c.name)) run.writes.push(c.input?.file_path ?? c.input?.notebook_path ?? '');
          if (c.name === 'Skill') run.skills.push(c.input?.skill);
          if (c.input?.command) run.commands.push(c.input.command);
        }
        if (ev.type === 'result') {
          run.text = ev.result ?? ''; run.cost = ev.total_cost_usd ?? null; run.ms = ev.duration_ms ?? null; run.turns = ev.num_turns ?? null;
          if (ev.is_error) run.error = ev.subtype;
        }
      }
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (run.cost === null && !run.error) run.error = `no result (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`;
      done(run);
    });
    child.stdin.end(prompt);
  });
}

function judge(sc, run) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const rx = (p) => new RegExp(p, 'i');
  for (const s of sc.skillsAll ?? []) add(`skill ${s}`, run.skills.includes(s));
  if (sc.skillsAny?.length) add(`any skill of ${sc.skillsAny.join('|')}`, sc.skillsAny.some((s) => run.skills.includes(s)));
  const planDir = join(home(), '.claude', 'plans').toLowerCase();
  const repoWrites = run.writes.filter((p) => !resolve(p).toLowerCase().startsWith(planDir));
  for (const t of sc.toolsNone ?? []) {
    if (['Edit', 'Write', 'NotebookEdit'].includes(t)) continue;
    add(`no ${t}`, !run.tools.includes(t));
  }
  if ((sc.toolsNone ?? []).some((t) => ['Edit', 'Write', 'NotebookEdit'].includes(t))) add('no write outside the plan file', !repoWrites.length, repoWrites.join(', '));
  for (const b of sc.bashNone ?? []) { const hit = run.commands.find((c) => rx(b).test(c)); add(`no command /${b}/`, !hit, hit ?? ''); }
  const seen = `${run.allText ?? ''}\n${run.text}`;
  for (const p of sc.textAll ?? []) add(`text /${p}/`, rx(p).test(seen));
  if (sc.textAny?.length) add(`text any of ${sc.textAny.length}`, sc.textAny.some((p) => rx(p).test(seen)));
  const unnamed = [...new Set(run.skills)].filter((s) => s && !(run.allText + run.text).toLowerCase().includes(s.split(':').at(-1).toLowerCase()));
  add('names the skills it used', unnamed.length === 0, unnamed.join(', '));
  if (run.error) add('run finished', false, run.error);
  return checks;
}

export default async function run(args) {
  const conf = cfg();
  const spec = JSON.parse(readFileSync(join(HARNESS, 'evals', 'scenarios.json'), 'utf8'));
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
  const dry = args.includes('--dry-run');
  const list = spec.scenarios.filter((s) => !only || only.includes(s.id)).map((s) => ({ ...spec.defaults, ...s }));
  const repos = conf.evalRepos ?? {};
  const cap = list.reduce((n, s) => n + s.maxBudgetUsd, 0);
  console.log(`${list.length} scenario(s), spend cap $${cap.toFixed(2)} (--max-budget-usd per run)`);
  if (dry) { for (const s of list) console.log(`  ${s.id}  [${s.repo} → ${repos[s.repo] ?? 'MISSING evalRepos'}]  "${s.prompt}"`); return; }
  const risk = keyRisk(Object.values(repos));
  if (risk.length) { console.error(`refusing to run: an API key or provider account could be used (${risk.join(', ')}). Evals run on the subscription login only.`); process.exit(1); }
  const results = [];
  for (const s of list) {
    if (results.some((r) => r.error?.startsWith('api key'))) { console.log(`STOP: an API key was in use; remaining scenarios not run`); break; }
    const cwd = repos[s.repo];
    if (!cwd || !existsSync(cwd)) { console.log(`SKIP ${s.id}: evalRepos.${s.repo} not set`); continue; }
    process.stdout.write(`… ${s.id} `);
    const run = await runClaude(s.prompt, cwd, s);
    if (run.error?.startsWith('no result')) {
      results.push({ id: s.id, pass: false, checks: [], ...run });
      console.log(`ERROR  ${run.error}`);
      continue;
    }
    const checks = judge(s, run);
    const pass = checks.every((c) => c.ok);
    results.push({ id: s.id, pass, checks, ...run });
    console.log(`${pass ? 'PASS' : 'FAIL'}  $${run.cost?.toFixed(3) ?? '?'}  ${Math.round((run.ms ?? 0) / 1000)}s  skills: ${run.skills.join(', ') || '-'}`);
    for (const c of checks.filter((c) => !c.ok)) console.log(`     ✗ ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  }
  const total = results.reduce((n, r) => n + (r.cost ?? 0), 0);
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass, cost $${total.toFixed(3)}`);
  const outDir = join(conf.storeRoot ?? join(home(), '.narvai'), 'dev-harness', 'evals');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), total_cost_usd: total, results }, null, 2));
  console.log(`results: ${out}`);
}
