#!/usr/bin/env node
// narvai CLI (node 22+, any OS). Commands:
//   setup [--root <dir>] [--claude-subscription] [--dry-run]
//                                            install --adopt, then wire Hermes, AgentMemory, MCP, Codex and Orca (setup.mjs)
//   install [--root <dir>] [--adopt]         config, sync, vendored third-party skills, Claude hooks
//   sync                                     link hub skills into every agent, rules from rules/GLOBAL.md, Qwen pointer
//   doctor                                   what is installed, stale or missing
//   usage [--days N]                         which skills are actually used
//   estimate <path|file>... [--diff[=ref]]   token estimate of what a worker would read (bytes / 3.6)
//   eval [--only=id,id] [--dry-run]          run evals/scenarios.json through headless Claude (costs tokens)
//   verify [--all] [--hook]                  definition of done for the current repo (store verify.json or stack defaults);
//                                            --hook skips checks marked "hook": false
//   hooks <repo>                             install a pre-push hook that runs verify; an existing hook is kept and runs first
import { execFileSync, execSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cfgPath = join(homedir(), '.narvai', 'config.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const CHARS_PER_TOKEN = 3.6;
const SKIP = new Set(['node_modules', '.git', 'bin', 'obj', '.next', 'dist', 'build', 'coverage', 'storybook-static']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|dll|exe|woff2?|ttf|mp4|glb|bin)$/i;

function* files(p) {
  const st = statSync(p);
  if (st.isFile()) { if (!BINARY.test(p)) yield [p, st.size]; return; }
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    yield* files(join(p, e.name));
  }
}

function estimate(args) {
  const diffArg = args.find((a) => a.startsWith('--diff'));
  const targets = args.filter((a) => !a.startsWith('--diff'));
  if (diffArg) {
    const ref = diffArg.includes('=') ? diffArg.split('=')[1] : 'HEAD';
    const changed = execFileSync('git', ['diff', '--name-only', ref], { encoding: 'utf8' }).split('\n').filter((f) => f && existsSync(f));
    targets.push(...changed);
  }
  if (!targets.length) { console.error('usage: narvai estimate <path>... [--diff[=ref]]'); process.exit(2); }
  let total = 0;
  for (const t of targets) {
    if (!existsSync(t)) { console.log(`  missing  ${t}`); continue; }
    let bytes = 0, n = 0;
    for (const [, size] of files(t)) { bytes += size; n++; }
    const tokens = Math.round(bytes / CHARS_PER_TOKEN);
    total += tokens;
    console.log(`  ${String(Math.round(tokens / 1000)).padStart(5)}K  ${n} file(s)  ${relative(process.cwd(), t) || t}`);
  }
  const budget = cfg.workerReadBudget ?? 60_000;
  console.log(`total ~${Math.round(total / 1000)}K tokens (estimated, ±25%); worker read budget ${Math.round(budget / 1000)}K: ${total <= budget ? 'fits' : 'SPLIT the slice'}`);
}

// Evals run on the user's Claude subscription login only, never on an API key or a cloud provider account.
const KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

function keyRisk(repos) {
  const found = KEY_VARS.filter((v) => process.env[v]).map((v) => `env ${v}`);
  const files = [join(homedir(), '.claude', 'settings.json'), join(homedir(), '.claude', 'settings.local.json')];
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
  const planDir = join(homedir(), '.claude', 'plans').toLowerCase();
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

async function evals(args) {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'evals', 'scenarios.json');
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
  const dry = args.includes('--dry-run');
  const list = spec.scenarios.filter((s) => !only || only.includes(s.id)).map((s) => ({ ...spec.defaults, ...s }));
  const repos = cfg.evalRepos ?? {};
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
  const outDir = join(cfg.storeRoot ?? join(homedir(), '.narvai'), 'dev-harness', 'evals');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), total_cost_usd: total, results }, null, 2));
  console.log(`results: ${out}`);
}

const git = (args, cwd) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const norm = (p) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();

function storeFor(repo) {
  const root = process.env.AI_HARNESS_MEMORY ?? cfg.storeRoot;
  const mapPath = root && join(root, 'map.json');
  if (!mapPath || !existsSync(mapPath)) return null;
  const hit = Object.entries(JSON.parse(readFileSync(mapPath, 'utf8'))).find(([r]) => norm(r) === norm(repo));
  return hit?.[1] ?? null;
}

function changedFiles(repo) {
  const upstream = git(['rev-parse', '--abbrev-ref', '@{u}'], repo);
  const base = upstream || ['origin/development', 'origin/main', 'origin/master'].find((b) => git(['rev-parse', '--verify', '-q', b], repo));
  const files = new Set();
  if (base) for (const f of git(['diff', '--name-only', `${base}...HEAD`], repo).split('\n')) if (f) files.add(f);
  for (const f of git(['diff', '--name-only', 'HEAD'], repo).split('\n')) if (f) files.add(f);
  return { base: base ?? '(none)', files: [...files] };
}

function defaultChecks(repo) {
  const sln = readdirSync(repo).find((f) => /\.slnx?$/.test(f));
  if (sln) return [{ name: 'build', run: `dotnet build ${sln} -c Release -nodeReuse:false -v:q` }];
  if (existsSync(join(repo, 'package.json'))) {
    const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts ?? {};
    const pm = existsSync(join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(repo, 'yarn.lock')) ? 'yarn' : 'npm run';
    return ['typecheck', 'lint', 'test'].filter((s) => scripts[s]).map((s) => ({ name: s, run: `${pm} ${s}` }));
  }
  return [];
}

function verify(args) {
  const repo = git(['rev-parse', '--show-toplevel'], process.cwd());
  if (!repo) { console.error('not inside a git repository'); process.exit(2); }
  const store = storeFor(repo);
  const vPath = store && join(store, 'verify.json');
  const spec = vPath && existsSync(vPath) ? JSON.parse(readFileSync(vPath, 'utf8')) : null;
  const checks = spec?.checks ?? defaultChecks(repo);
  const all = args.includes('--all');
  const inHook = args.includes('--hook');
  const { base, files } = changedFiles(repo);
  console.log(`narvai verify: ${repo}  (${spec ? 'verify.json' : 'stack defaults'}; ${files.length} changed file(s) vs ${base})`);
  if (!spec) console.log('  note: no verify.json in the store, so test projects are not known; only the defaults run');
  let failed = 0;
  for (const c of checks) {
    const hit = all || !c.when || files.some((f) => c.when.some((g) => matchesGlob(f, g)));
    if (!hit) { console.log(`  SKIPPED  ${c.name}  (no changed file matches)`); continue; }
    if (inHook && c.hook === false) { console.log(`  SKIPPED  ${c.name}  (not in the pre-push hook; run narvai verify)`); continue; }
    if (c.requiresEnv && !process.env[c.requiresEnv]) { console.log(`  SKIPPED  ${c.name}  (${c.requiresEnv} not set, so it proves nothing)`); continue; }
    let cmd = c.run;
    if (c.scope) {
      const depth = c.scope.split('/').length;
      const dirs = [...new Set(files.filter((f) => matchesGlob(f, `${c.scope}/**`)).map((f) => f.split('/').slice(0, depth).join('/')))].filter((d) => existsSync(join(repo, d)));
      if (dirs.length) cmd += ' ' + dirs.join(' ');
    }
    const t0 = Date.now();
    try {
      execSync(cmd, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      console.log(`  PASS     ${c.name}  ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) {
      failed++;
      console.log(`  FAIL     ${c.name}  ${Math.round((Date.now() - t0) / 1000)}s  (${cmd})`);
      const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n');
      if (out) console.log(out.replace(/^/gm, '           '));
    }
  }
  for (const m of spec?.manual ?? []) console.log(`  MANUAL   ${m}`);
  if (spec && spec.remoteCi === false) console.log('  (no remote CI: this run is the gate)');
  process.exit(failed ? 1 : 0);
}

function installHooks(args) {
  const repo = git(['rev-parse', '--show-toplevel'], args[0] ?? process.cwd());
  if (!repo) { console.error('usage: narvai hooks <repo>'); process.exit(2); }
  const hooksDir = resolve(repo, git(['rev-parse', '--git-path', 'hooks'], repo));
  const hook = join(hooksDir, 'pre-push');
  const marker = '# narvai pre-push';
  if (existsSync(hook) && readFileSync(hook, 'utf8').includes(marker)) { console.log(`already installed: ${hook}`); return; }
  if (existsSync(hook)) {
    const local = join(hooksDir, 'pre-push.local');
    if (existsSync(local)) { console.error(`${local} exists; refusing to overwrite`); process.exit(1); }
    renameSync(hook, local);
    console.log(`kept the existing hook as ${local}; it runs first`);
  }
  const cli = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  writeFileSync(hook, `#!/bin/sh\n${marker}\nd="$(dirname "$0")"\nrefs="$(cat)"\nif [ -x "$d/pre-push.local" ]; then printf '%s\\n' "$refs" | "$d/pre-push.local" "$@" || exit $?; fi\nnode "${cli}" verify --hook || { echo "narvai verify failed. Fix it, or push with --no-verify if you accept the risk."; exit 1; }\n`);
  chmodSync(hook, 0o755);
  console.log(`installed: ${hook}`);
}

const HARNESS = dirname(fileURLToPath(import.meta.url));
const tilde = (p) => p.replace(/^~(?=[\\/]|$)/, homedir());
function backup(file) {
  if (!existsSync(file)) return;
  const dir = join(homedir(), '.narvai', 'backups');
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, join(dir, `${file.split(/[\\/]/).slice(-2).join('_')}.${Date.now()}`));
}
// One physical copy per skill, in this repo: every agent's skill dir holds junctions (symlinks off Windows) to it.
const skillTargets = () => [join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills'), join(homedir(), '.gemini', 'config', 'skills'), join(homedir(), '.pi', 'agent', 'skills')]
  .filter((d) => existsSync(dirname(d)));
const sameDir = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };

function link(src, dst) {
  if (sameDir(src, dst)) return false;
  if (lstatSync(dst, { throwIfNoEntry: false })) {
    const bak = join(homedir(), '.narvai', 'backups', 'skills', `${dst.split(/[\\/]/).slice(-3).join('_')}.${Date.now()}`);
    mkdirSync(dirname(bak), { recursive: true });
    renameSync(dst, bak);
  }
  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(src, dst, 'junction');
  return true;
}

function syncSkill() {
  const src = join(HARNESS, 'skills', 'narvai-orchestrator');
  for (const dir of skillTargets()) console.log(`  ${link(src, join(dir, 'narvai-orchestrator')) ? 'LINK' : 'OK  '} narvai-orchestrator -> ${dir}`);
}

function writeGenerated(dst, body) {
  if (!existsSync(dirname(dst))) return;
  if (existsSync(dst)) {
    const cur = readFileSync(dst, 'utf8');
    if (cur === body) { console.log(`  OK   rules current: ${dst}`); return; }
    if (!/GENERATED by (setup-dev-harness|narvai)/.test(cur) && !process.argv.includes('--adopt')) {
      console.log(`  WARN ${dst} was not generated by narvai; left alone (rerun with --adopt to take it over, a backup is kept)`);
      return;
    }
  }
  backup(dst);
  writeFileSync(dst, body);
  console.log(`  OK   rules generated: ${dst}`);
}

const hermesHome = () => process.env.HERMES_HOME
  || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'hermes') : join(homedir(), '.hermes'));
const nativeRoot = () => (cfg.aiRoot ?? defaultRoot()).replace(/[\\/]/g, process.platform === 'win32' ? '\\' : '/');

// Every agent gets the same rendered copy of rules/GLOBAL.md; {{AI_ROOT}} becomes the configured root and
// {{MEMORY_PROJECT}} the single AgentMemory scope every repository shares.
function syncRules(lib) {
  const read = (f) => readFileSync(join(HARNESS, 'rules', f), 'utf8').replace(/\r\n/g, '\n')
    .replaceAll('{{AI_ROOT}}', nativeRoot()).replaceAll('{{MEMORY_PROJECT}}', cfg.memoryProject ?? 'shared').trimEnd();
  const head = '<!-- GENERATED by narvai.mjs sync from rules/GLOBAL.md. Do not edit here. -->\n<!-- Edit the source, then rerun: node narvai.mjs sync -->\n\n';
  const tail = '\n\n' + narvaiBlock(lib, '\n') + '\n';
  const rules = read('GLOBAL.md');
  for (const dst of [join(homedir(), '.claude', 'CLAUDE.md'), join(homedir(), '.codex', 'AGENTS.md'), join(homedir(), '.gemini', 'config', 'GEMINI.md'), join(homedir(), '.pi', 'agent', 'AGENTS.md')]) {
    writeGenerated(dst, head + rules + tail);
  }
  writeGenerated(join(hermesHome(), 'SOUL.md'), head + read('hermes-identity.md') + '\n\n' + rules + tail);
}

function narvaiBlock(lib, eol) {
  return [
    '<!-- narvai:start -->', '## Development', '',
    'Kodla, repoyla ya da teslimatla ilgili her istekte ve kullanici "narvai" dediginde narvai-orchestrator skill\'ini oku',
    '(bu aracin skills klasorunde; yoksa `' + lib + '/narvai-orchestrator/SKILL.md`) ve ona gore ilerle.',
    'Proje-yerel `AGENTS.md` / `CLAUDE.md` kurallari her zaman ustundur. Narvai bir skill\'e yonlendirirse ve o skill burada',
    'kurulu degilse dosyasini dogrudan oku: `' + lib + '/<ad>/SKILL.md`.',
    'Is durumu repo disinda, store\'da durur (`~/.narvai/config.json` storeRoot + `map.json`). Surdurulen bir is icin store\'daki',
    '`work/<id>/state.yaml` ve `PROGRESS.md` dosyalarini oku, `next_action`dan devam et. Sohbet gecmisi handoff protokolu degildir.',
    '<!-- narvai:end -->',
  ].join(eol);
}

function pointer(file, lib) {
  if (!existsSync(dirname(file))) return;
  let t = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const block = narvaiBlock(lib, eol);
  const before = t;
  t = t.replace(/\r?\n## Development\r?\n\r?\nKodla, repoyla[\s\S]*?gecmisi handoff protokolu degildir\.\r?\n?/, eol);
  t = t.replace(/<!-- narvai:start -->[\s\S]*?<!-- narvai:end -->\r?\n?/, '');
  t = t.replace(/\s*$/, eol + eol) + block + eol;
  if (t === before) { console.log(`  OK   pointer current: ${file}`); return; }
  backup(file);
  writeFileSync(file, t);
  console.log(`  OK   pointer written: ${file}`);
}

function installThirdParty() {
  const m = JSON.parse(readFileSync(join(HARNESS, 'third-party.json'), 'utf8'));
  let n = 0;
  for (const s of m.sources) {
    for (const sk of s.skills) {
      const from = join(HARNESS, 'third-party', 'skills', sk);
      if (!existsSync(from)) { console.log(`  WARN vendored copy missing: ${sk}`); continue; }
      for (const dir of skillTargets()) link(from, join(dir, sk));
      n++;
    }
    for (const a of s.agents ?? []) {
      const agents = join(homedir(), '.claude', 'agents');
      mkdirSync(agents, { recursive: true });
      copyFileSync(join(HARNESS, 'third-party', 'agents', `${a}.md`), join(agents, `${a}.md`));
    }
    const done = s.done && (s.done.startsWith('which:') ? which(s.done.slice(6)) : existsSync(tilde(s.done.slice(5))));
    for (const step of s.manual ?? []) console.log(done ? `  OK   ${s.repo}: already set up` : `  TODO ${s.repo}: ${step}`);
  }
  console.log(`  OK   ${n} third-party skills linked into ${skillTargets().join(', ')}`);
  const sp = join(homedir(), '.claude', 'settings.json');
  const enabled = existsSync(sp) ? Object.keys(JSON.parse(readFileSync(sp, 'utf8')).enabledPlugins ?? {}).map((k) => k.split('@')[0]) : [];
  const missingPlugins = m.plugins.names.filter((p) => !enabled.includes(p.split(' ')[0]));
  console.log(missingPlugins.length ? `  TODO Claude Code plugins (install with /plugin): ${missingPlugins.join(', ')}` : '  OK   Claude Code plugins enabled');
}

function registerClaudeHooks() {
  const p = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(dirname(p))) return;
  const s = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  const h = HARNESS.replace(/\\/g, '/');
  const want = [
    ['UserPromptSubmit', undefined, `node "${h}/hooks/narvai-guard.mjs" || true`],
    ['PostToolUse', '*', `node "${h}/hooks/narvai-guard.mjs" || true`],
    ['PostToolUse', 'Bash', `node "${h}/hooks/ua-auto-update.mjs" || true`],
    ['SessionStart', 'startup|resume|clear', `node "${h}/hooks/store-context.mjs" || echo {}`],
    ['SessionStart', 'compact', `node "${h}/hooks/store-context.mjs" compact || echo {}`],
  ];
  const ours = /ai-store-context|store-context\.mjs|narvai-guard\.mjs|ua-auto-update\.mjs/;
  s.hooks ??= {};
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = s.hooks[ev].map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((x) => !ours.test(x.command ?? '')) })).filter((e) => e.hooks.length);
  }
  for (const [ev, matcher, command] of want) {
    s.hooks[ev] ??= [];
    const entry = { hooks: [{ type: 'command', command, timeout: 10 }] };
    if (matcher) entry.matcher = matcher;
    s.hooks[ev].push(entry);
  }
  backup(p);
  writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  console.log(`  OK   Claude hooks registered (${want.length}) -> ${p}`);
}

// --root moves the layout (Harness, Features, Memory, Worktrees, Apps) somewhere else; data already under the old root stays put.
function initConfig() {
  const i = process.argv.indexOf('--root');
  const asked = i > 0 ? process.argv[i + 1]?.replace(/\\/g, '/') : undefined;
  const root = asked ?? cfg.aiRoot ?? defaultRoot();
  const derived = { aiRoot: root, storeRoot: `${root}/Features/_harness`, docsRoot: `${root}/Features` };
  const next = existsSync(cfgPath) && !asked
    ? { ...cfg, aiRoot: root }
    : { language: 'tr', subagentWarn: 200000, subagentReturn: 300000, workerReadBudget: 60000, evalRepos: {}, ...cfg, ...derived };
  mkdirSync(next.storeRoot, { recursive: true });
  if (!existsSync(join(next.storeRoot, 'map.json'))) writeFileSync(join(next.storeRoot, 'map.json'), '{}\n');
  if (JSON.stringify(next) === JSON.stringify(cfg)) { console.log(`  OK   config: ${cfgPath} (aiRoot ${root})`); return; }
  mkdirSync(dirname(cfgPath), { recursive: true });
  backup(cfgPath);
  writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n');
  Object.assign(cfg, next);
  console.log(`  OK   config written: ${cfgPath} (aiRoot ${root})`);
}

function defaultRoot() {
  return process.platform === 'win32' ? 'C:/Projects/AI' : join(homedir(), 'AI').replace(/\\/g, '/');
}

function sync() {
  console.log('narvai sync');
  syncSkill();
  const lib = tilde(JSON.parse(readFileSync(join(HARNESS, 'third-party.json'), 'utf8')).skillLibrary).replace(/\\/g, '/');
  syncRules(lib);
  pointer(join(homedir(), '.qwen', 'QWEN.md'), lib);
}

function install() {
  console.log('narvai install');
  initConfig();
  sync();
  installThirdParty();
  registerClaudeHooks();
  console.log('next: `node narvai.mjs doctor`; per repo: add it to map.json with a store folder, then `node narvai.mjs hooks <repo>`');
}

function which(x) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [x], { stdio: 'ignore' }); return true; } catch { return false; }
}

function doctor() {
  const rows = [];
  const add = (ok, what, hint = '') => rows.push(`  ${ok === true ? 'OK  ' : ok === null ? 'WARN' : 'MISS'} ${what}${hint && ok !== true ? `  (${hint})` : ''}`);
  add(Number(process.versions.node.split('.')[0]) >= 22, `node ${process.versions.node}`, 'needs 22+');
  add(which('git'), 'git');
  add(existsSync(cfgPath), `config ${cfgPath}`, 'run install');
  const store = cfg.storeRoot && tilde(cfg.storeRoot);
  add(Boolean(store && existsSync(store)), `store ${store ?? '-'}`);
  if (store && existsSync(join(store, 'map.json'))) {
    const map = JSON.parse(readFileSync(join(store, 'map.json'), 'utf8'));
    const gone = Object.keys(map).filter((r) => !existsSync(r));
    add(gone.length ? null : true, `map.json: ${Object.keys(map).length} repos`, gone.length ? `${gone.length} paths no longer exist` : '');
  }
  for (const dir of skillTargets()) add(sameDir(join(HARNESS, 'skills', 'narvai-orchestrator'), join(dir, 'narvai-orchestrator')), `narvai link in ${dir}`, 'run sync');
  const claudeMd = join(homedir(), '.claude', 'CLAUDE.md');
  add(existsSync(claudeMd) && readFileSync(claudeMd, 'utf8').includes('GENERATED by narvai.mjs sync from rules/GLOBAL.md'), 'Claude CLAUDE.md generated from rules/GLOBAL.md', 'run sync --adopt');
  const tp = JSON.parse(readFileSync(join(HARNESS, 'third-party.json'), 'utf8'));
  const lib = tilde(tp.skillLibrary);
  const missing = tp.sources.flatMap((s) => s.skills).filter((sk) => !existsSync(join(lib, sk, 'SKILL.md')));
  add(!missing.length, `third-party skills in ${lib}`, missing.length ? `missing: ${missing.join(', ')}` : '');
  const sp = join(homedir(), '.claude', 'settings.json');
  if (existsSync(sp)) {
    const cmds = Object.values(JSON.parse(readFileSync(sp, 'utf8')).hooks ?? {}).flat().flatMap((e) => (e.hooks ?? []).map((x) => x.command ?? ''));
    for (const f of ['narvai-guard.mjs', 'store-context.mjs', 'ua-auto-update.mjs']) add(cmds.some((c) => c.includes(f)), `Claude hook ${f}`, 'run install');
    if (cmds.some((c) => c.includes('ai-store-context'))) add(null, 'old PowerShell store hook still registered', 'run install to switch to node');
  }
  for (const t of tp.tools.recommended) add(which(t) || null, `tool ${t}`, 'recommended');
  for (const t of tp.tools.heavy) add(which(t) || null, `tool ${t}`, 'Heavy Mode, install when needed');
  console.log('narvai doctor');
  console.log(rows.join('\n'));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'estimate') estimate(rest);
else if (cmd === 'eval') await evals(rest);
else if (cmd === 'verify') verify(rest);
else if (cmd === 'hooks') installHooks(rest);
else if (cmd === 'install') install();
else if (cmd === 'sync') sync();
else if (cmd === 'doctor') doctor();
else if (cmd === 'usage') await import(pathToFileURL(join(HARNESS, 'skill-usage.mjs')).href);
else if (cmd === 'setup') await import(pathToFileURL(join(HARNESS, 'setup.mjs')).href);
else { console.error('commands: setup [--root <dir>] [--claude-subscription] [--dry-run], install [--root <dir>] [--adopt], sync [--adopt], doctor, usage [--days N], estimate, eval [--only=id,id] [--dry-run], verify [--all] [--hook], hooks <repo>'); process.exit(2); }
