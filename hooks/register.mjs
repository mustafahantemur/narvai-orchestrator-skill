import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backup, HARNESS } from '../cli/ortak.mjs';

// Ours: the old hook files by name, and guard.mjs only in the form this file writes (path, then the harness name).
const OURS = /ai-store-context|store-context\.mjs|narvai-guard\.mjs|ua-auto-update\.mjs|hooks[\\/]guard\.mjs"? (?:claude|codex)\s*$/;
export const TOOL_MATCHER = '^(?:Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit|apply_patch|mcp__.*)$';

function merge(file, h) {
  const s = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const before = JSON.stringify(s);
  const command = `node "${HARNESS.replace(/\\/g, '/')}/hooks/guard.mjs" ${h}`;
  s.hooks ??= {};
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = s.hooks[ev].map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((x) => !OURS.test(x.command ?? '')) })).filter((e) => e.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  (s.hooks.PreToolUse ??= []).push({ matcher: TOOL_MATCHER, hooks: [{ type: 'command', command, timeout: 10 }] });
  (s.hooks.SessionStart ??= []).push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  if (JSON.stringify(s) === before) return false;
  backup(file);
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  return true;
}

export function registerHooks({ home }) {
  const targets = [['Claude', join(home, '.claude'), 'settings.json', 'claude'], ['Codex', join(home, '.codex'), 'hooks.json', 'codex']];
  for (const [name, dir, f, h] of targets) {
    if (!existsSync(dir)) continue;
    const file = join(dir, f);
    const changed = merge(file, h);
    console.log(`  OK   ${name} hooks ${changed ? 'registered' : 'current'}: ${file}`);
    if (changed && h === 'codex') console.log('  TODO Codex: run /hooks in codex and trust the narvai guard entries (PreToolUse, SessionStart); until then Codex skips them');
  }
}
