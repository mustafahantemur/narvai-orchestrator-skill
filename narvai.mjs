#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COMMANDS = {
  context: '[--hook]  rules, stacks, store, checks and open work for this repo',
  next: '--event <step> [--paths <files>]  the skills for this step (plan, build, edit, failure, done, review, ...)',
  verify: '[--all] [--changed] [--tests]  build, typecheck and lint; test checks only with --tests',
  tests: '[--base <ref>] [--failed <file>...]  changed sources whose tests were not touched; which side of a red test changed last',
  contract: '[--base <ref>]  contract steps when a contract path changed',
  skill: '<name> | --list [--stack s]  path and description of a skill',
  graph: '<build|status|refresh|memory> [--only repo] [--worktree|--head] [--merge] [--reset] [--migrate]  build or check the code graphs and the knowledge graph of the shared memory',
  allow: '<rule-id> [--minutes n]  temporary exception to a guard rule; needs a terminal, so only a person runs it',
  guard: '[apply [<file>]]  list the guard rules, or put your own rules in force from their source (logged)',
  doctor: '[--fix]  installation, rules, routes, guard, memory and graph checks',
  eval: '[--only=id,id] [--dry-run] [--rejudge=<dir>]  evals/scenarios.json through headless Claude (uses tokens)',
  sync: '[--adopt]  rule files, skill links, agents, hooks',
  install: '[--root <dir>] [--adopt]  config, sync, vendored skills, hooks',
  setup: '[--root <dir>] [--claude-subscription] [--dry-run]  install --adopt, then Hermes, AgentMemory, MCP, Codex, Orca',
  usage: '[--days N]  which skills are actually used',
  estimate: '<path|file>... [--diff[=ref]]  token estimate of what a worker would read',
  hooks: '[<repo>] [--remove]  git hooks: verify before push, stale-test note at commit',
};

const [cmd, ...args] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, cmd ?? '')) {
  if (cmd) console.error(`narvai: unknown command ${cmd}`);
  for (const [c, d] of Object.entries(COMMANDS)) console.log(`narvai ${c} ${d}`);
  process.exit(cmd ? 2 : 0);
}
const file = join(dirname(fileURLToPath(import.meta.url)), 'cli', `${cmd}.mjs`);
if (!existsSync(file)) { console.error(`narvai ${cmd}: not built yet`); process.exit(2); }
try {
  await (await import(pathToFileURL(file).href)).default(args);
} catch (e) {
  console.error(`narvai ${cmd}: ${String(e?.message ?? e).split('\n')[0]}`);
  process.exit(1);
}
