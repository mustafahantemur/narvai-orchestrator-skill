import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, cfg, cfgPath, HARNESS, home, readJson, tilde, which } from './ortak.mjs';
import sync from './sync.mjs';

function installThirdParty() {
  const m = JSON.parse(readFileSync(join(HARNESS, 'third-party.json'), 'utf8'));
  let n = 0;
  for (const s of m.sources) {
    for (const sk of s.skills) {
      if (existsSync(join(HARNESS, 'third-party', 'skills', sk, 'SKILL.md'))) n++;
      else console.log(`  WARN vendored copy missing: ${sk}`);
    }
    for (const a of s.agents ?? []) {
      const agents = join(home(), '.claude', 'agents');
      mkdirSync(agents, { recursive: true });
      backup(join(agents, `${a}.md`));
      copyFileSync(join(HARNESS, 'third-party', 'agents', `${a}.md`), join(agents, `${a}.md`));
    }
    const done = s.done && (s.done.startsWith('which:') ? which(s.done.slice(6)) : existsSync(tilde(s.done.slice(5))));
    for (const step of s.manual ?? []) console.log(done ? `  OK   ${s.repo}: already set up` : `  TODO ${s.repo}: ${step}`);
  }
  console.log(`  OK   ${n} third-party skills vendored; narvai sync links the listed ones`);
  const sp = join(home(), '.claude', 'settings.json');
  const on = Object.entries(readJson(sp, {}).enabledPlugins ?? {}).filter(([, v]) => v).map(([k]) => k.split('@')[0]);
  const missingPlugins = m.plugins.keep.filter((p) => !on.includes(p));
  console.log(missingPlugins.length ? `  TODO Claude Code plugins (install with /plugin): ${missingPlugins.join(', ')}` : '  OK   Claude Code plugins enabled');
}

// --root moves the layout (Harness, Features, Memory, Worktrees, Apps) somewhere else; data already under the old root stays put.
function initConfig(args) {
  const cur = cfg();
  const i = args.indexOf('--root');
  const asked = i >= 0 ? args[i + 1]?.replace(/\\/g, '/') : undefined;
  const root = asked ?? cur.aiRoot ?? join(home(), 'AI').replace(/\\/g, '/');
  const derived = { aiRoot: root, storeRoot: `${root}/Features/_harness`, docsRoot: `${root}/Features` };
  const next = existsSync(cfgPath()) && !asked
    ? { ...cur, aiRoot: root }
    : { language: 'tr', subagentWarn: 200000, subagentReturn: 300000, workerReadBudget: 60000, evalRepos: {}, ...cur, ...derived };
  mkdirSync(next.storeRoot, { recursive: true });
  if (!existsSync(join(next.storeRoot, 'map.json'))) writeFileSync(join(next.storeRoot, 'map.json'), '{}\n');
  if (JSON.stringify(next) === JSON.stringify(cur)) { console.log(`  OK   config: ${cfgPath()} (aiRoot ${root})`); return; }
  mkdirSync(dirname(cfgPath()), { recursive: true });
  backup(cfgPath());
  writeFileSync(cfgPath(), JSON.stringify(next, null, 2) + '\n');
  console.log(`  OK   config written: ${cfgPath()} (aiRoot ${root})`);
}

export default async function run(args = []) {
  console.log('narvai install');
  initConfig(args);
  await sync(args);
  installThirdParty();
  console.log('next: `node narvai.mjs doctor`; per repo: add it to map.json with a store folder, then `node narvai.mjs hooks <repo>`');
}
