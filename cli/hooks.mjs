import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git, HARNESS, readJson, storeRoot } from './ortak.mjs';

const BEGIN = (hook) => `# >>> narvai ${hook}`;
const END = (hook) => `# <<< narvai ${hook}`;
const SHEBANG = '#!/bin/sh\n';

export function withoutBlock(text, hook) {
  const out = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line.trimEnd() === BEGIN(hook)) inside = true;
    else if (line.trimEnd() === END(hook)) inside = false;
    else if (!inside) out.push(line);
  }
  return out.join('\n');
}

export function withBlock(text, hook, body) {
  const rest = withoutBlock(text || SHEBANG, hook);
  return `${rest}${rest.endsWith('\n') ? '' : '\n'}${BEGIN(hook)}\n${body}\n${END(hook)}\n`;
}

// Each block keeps the exit status the hook had before it, so appending never hides a failure.
export function blocks(cli, graphRepo) {
  const node = `node "${cli}"`;
  const refresh = `(${node} graph build --only "${graphRepo}" --head >/dev/null 2>&1 &)`;
  const keep = (lines) => ['narvai_rc=$?', ...lines, '(exit "$narvai_rc")'].join('\n');
  return {
    'pre-push': ['narvai_rc=$?; [ "$narvai_rc" -eq 0 ] || exit "$narvai_rc"',
      `${node} verify --changed || { echo "narvai verify failed. Fix it, or push with --no-verify if you accept the risk."; exit 1; }`].join('\n'),
    'pre-commit': keep([`${node} tests >&2`]),
    'post-commit': graphRepo ? keep([refresh]) : null,
    'post-merge': graphRepo ? keep([refresh]) : null,
    'post-checkout': graphRepo ? keep([`[ "$3" = 1 ] && ${refresh}`]) : null,
  };
}

// Before v2 the pre-push hook was a whole file and the user's hook was moved to pre-push.local.
function undoOldPrePush(dir) {
  const hook = join(dir, 'pre-push');
  if (!existsSync(hook) || !readFileSync(hook, 'utf8').includes('# narvai pre-push\n')) return;
  if (existsSync(`${hook}.local`)) renameSync(`${hook}.local`, hook);
  else rmSync(hook);
}

function graphRepoFor(repo) {
  const main = dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo));
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  let list;
  try { list = readJson(join(storeRoot(), 'graph', 'repos.json'), { repos: [] }); } catch { return null; }
  const name = list.repos?.find((r) => norm(r.path) === norm(main))?.name;
  return name && /^[\w.-]+$/.test(name) ? name : null;
}

export function installHooks(repo, { cli = join(HARNESS, 'narvai.mjs').replace(/\\/g, '/'), remove = false, graphRepo = graphRepoFor(repo) } = {}) {
  const dir = git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], repo);
  mkdirSync(dir, { recursive: true });
  undoOldPrePush(dir);
  const lines = [`narvai hooks: ${dir}${graphRepo ? `  (graph refresh for ${graphRepo})` : ''}`];
  for (const [hook, body] of Object.entries(blocks(cli, graphRepo))) {
    const file = join(dir, hook);
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const has = before.includes(BEGIN(hook));
    if (remove || body === null) {
      if (!has) continue;
      const rest = withoutBlock(before, hook);
      if (rest.trim() === SHEBANG.trim()) rmSync(file);
      else writeFileSync(file, rest);
      lines.push(`  removed    ${hook}`);
      continue;
    }
    if (before && !/^#!.*\b(ba|da|z)?sh\b/.test(before)) { lines.push(`  skipped    ${hook}  (not a shell script; add the narvai lines by hand)`); continue; }
    const after = withBlock(before, hook, body);
    if (after === before) { lines.push(`  unchanged  ${hook}`); continue; }
    writeFileSync(file, after);
    chmodSync(file, 0o755);
    lines.push(`  ${has ? 'updated  ' : 'installed'}  ${hook}`);
  }
  return lines;
}

export default async function run(args) {
  const repo = git(['rev-parse', '--show-toplevel'], args.find((a) => !a.startsWith('--')) ?? process.cwd());
  if (!repo) throw new Error('usage: narvai hooks [<repo>] [--remove]');
  console.log(installHooks(repo, { remove: args.includes('--remove') }).join('\n'));
}
