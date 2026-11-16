import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cfg } from './ortak.mjs';

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

export default async function run(args) {
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
  const budget = cfg().workerReadBudget ?? 60_000;
  console.log(`total ~${Math.round(total / 1000)}K tokens (estimated, ±25%); worker read budget ${Math.round(budget / 1000)}K: ${total <= budget ? 'fits' : 'SPLIT the slice'}`);
}
