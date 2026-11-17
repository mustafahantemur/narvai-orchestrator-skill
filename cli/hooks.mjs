import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, HARNESS } from './ortak.mjs';

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

// The block goes last, except in front of a closing top-level `exit`, which would otherwise skip it.
export function withBlock(text, hook, body) {
  const rest = withoutBlock(text || SHEBANG, hook);
  const block = `${BEGIN(hook)}\n${body}\n${END(hook)}`;
  const lines = rest.replace(/\n+$/, '').split('\n');
  if (/^exit\b/.test(lines.at(-1))) return [...lines.slice(0, -1), block, lines.at(-1), ''].join('\n');
  return `${rest}${rest.endsWith('\n') ? '' : '\n'}${block}\n`;
}

// Each block keeps the exit status the hook had before it, and does nothing when the harness is gone.
// The post-* hooks carried a graph rebuild until graphs followed the working tree; null removes those blocks.
export function blocks(cli) {
  const node = `node "${cli}"`;
  const here = (cmd) => `if [ -f "${cli}" ]; then ${cmd}; fi`;
  const keep = (cmd) => ['narvai_rc=$?', here(cmd), '(exit "$narvai_rc")'].join('\n');
  return {
    'pre-push': ['narvai_rc=$?; [ "$narvai_rc" -eq 0 ] || exit "$narvai_rc"',
      here(`${node} verify --changed || { echo "narvai verify failed. Fix it, or push with --no-verify if you accept the risk."; exit 1; }`)].join('\n'),
    'pre-commit': keep(`${node} tests >&2 || true`),
    'post-commit': null,
    'post-merge': null,
    'post-checkout': null,
  };
}

// Before v2 the pre-push hook was a whole file and the user's hook was moved to pre-push.local.
function undoOldPrePush(dir) {
  const hook = join(dir, 'pre-push');
  if (!existsSync(hook) || !readFileSync(hook, 'utf8').includes('# narvai pre-push\n')) return;
  if (existsSync(`${hook}.local`)) renameSync(`${hook}.local`, hook);
  else rmSync(hook);
}

export function installHooks(repo, { cli = join(HARNESS, 'narvai.mjs').replace(/\\/g, '/'), remove = false } = {}) {
  const dir = git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], repo);
  // core.hooksPath can point at a folder the repository tracks; nothing of narvai goes into a repository.
  if (!remove && git(['ls-files', '--', dir], repo)) return [`narvai hooks: ${dir} is tracked by the repository; nothing written. Add the narvai lines to your own hook by hand if you want them.`];
  mkdirSync(dir, { recursive: true });
  undoOldPrePush(dir);
  const lines = [`narvai hooks: ${dir}`];
  for (const [hook, body] of Object.entries(blocks(cli))) {
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
