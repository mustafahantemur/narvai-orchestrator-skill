import { matchesGlob } from 'node:path';
import { git, out, repoRoot, storeFor } from './ortak.mjs';
import { clip, profiles, repoFiles, resolveChecks, scriptFor, stacksOf } from './context.mjs';

export function defaultBase(repo) {
  const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repo);
  return [head, 'origin/development', 'origin/main', 'origin/master'].find((b) => b && git(['rev-parse', '--verify', '-q', b], repo)) ?? 'HEAD';
}

export function changedFiles(repo, base) {
  const lines = (a) => git(a, repo).split('\n').filter(Boolean);
  return [...new Set([...lines(['diff', '--name-only', `${base}...HEAD`]), ...lines(['diff', '--name-only', 'HEAD']), ...lines(['ls-files', '--others', '--exclude-standard'])])];
}

export function fillStep(step, repo, checks) {
  return step
    .replace(/\{check:([\w-]+)\}/g, (_, n) => checks.find((c) => c.name === n)?.run ?? 'narvai verify')
    .replace(/\{script:([^}]+)\}/g, (_, names) => scriptFor(repo, names.split('|')) ?? `no package.json script among ${names.replaceAll('|', ', ')}`);
}

export default async function run(args) {
  const repo = repoRoot();
  if (!repo) throw new Error('not inside a git repository: cd into one');
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : defaultBase(repo);
  if (!base || !git(['rev-parse', '--verify', '-q', base], repo)) throw new Error(`unknown base ${base}: pass --base <ref>`);
  const files = changedFiles(repo, base);
  const stacks = stacksOf(repoFiles(repo), profiles()).filter((p) => p.contract?.paths?.length);
  let store = null;
  try { store = storeFor(repo); } catch {}
  const lines = [];
  for (const p of stacks) {
    const hit = files.filter((f) => p.contract.paths.some((g) => matchesGlob(f, g)));
    if (!hit.length) continue;
    const { checks } = resolveChecks(repo, [p], store);
    lines.push(`contract change (${p.name}, ${hit.length} file(s) vs ${base}): ${hit.slice(0, 3).join(', ')}${hit.length > 3 ? ', ...' : ''}`);
    p.contract.steps.forEach((s, i) => lines.push(`${i + 1}. ${fillStep(s, repo, checks)}`));
  }
  if (lines.length) out(clip(lines, 15));
}
