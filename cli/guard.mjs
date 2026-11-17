import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backup, HARNESS, harness, home, out, readJson, writeJson } from './ortak.mjs';

const target = () => join(home(), '.narvai', 'guard.json');
const logFile = () => join(home(), '.narvai', 'guard.log');
const defaultSource = () => ['guard.rules.mjs', 'guard.rules.json'].map((f) => join(home(), '.narvai', f)).find(existsSync);

// A source is JSON ({ rules }) or a module that exports `rules`; a module keeps regular expressions free of JSON escaping.
async function load(file) {
  if (file.endsWith('.json')) return readJson(file, {}).rules ?? [];
  const m = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  return m.rules ?? m.default ?? [];
}

export function problems(rules, shippedIds = []) {
  const errs = [];
  const seen = new Set();
  for (const r of rules) {
    if (!r?.id || !/^[\w-]+$/.test(r.id)) { errs.push(`a rule without a usable id: ${JSON.stringify(r).slice(0, 60)}`); continue; }
    if (seen.has(r.id)) errs.push(`${r.id}: defined twice`);
    seen.add(r.id);
    if (shippedIds.includes(r.id)) errs.push(`${r.id}: that id belongs to a shipped rule`);
    if (!r.command && !r.tool) errs.push(`${r.id}: needs command or tool`);
    if (!r.reason || !r.instead) errs.push(`${r.id}: needs reason and instead`);
    for (const k of ['command', 'tool', 'path']) { try { if (r[k]) new RegExp(r[k]); } catch { errs.push(`${r.id}: ${k} does not compile`); } }
  }
  return errs;
}

export function difference(before, after) {
  const b = new Map(before.map((r) => [r.id, JSON.stringify(r)]));
  const a = new Map(after.map((r) => [r.id, JSON.stringify(r)]));
  return { added: [...a.keys()].filter((id) => !b.has(id)), removed: [...b.keys()].filter((id) => !a.has(id)), changed: [...a.keys()].filter((id) => b.has(id) && b.get(id) !== a.get(id)) };
}

const describe = (d) => [...d.added.map((x) => `+${x}`), ...d.removed.map((x) => `-${x}`), ...d.changed.map((x) => `~${x}`)].join(' ') || 'no difference';
export const lastChange = () => { try { return JSON.parse(readFileSync(logFile(), 'utf8').trim().split('\n').at(-1)); } catch { return null; } };
export const lastChangeLine = () => { const c = lastChange(); return c ? `last change ${c.at.slice(0, 10)} by ${c.by}: ${describe(c)}` : 'no change recorded'; };

// Rules change through this command only, and every change is logged, so a rule never disappears unseen.
export default async function run(args) {
  const shipped = readJson(join(HARNESS, 'hooks', 'deny.json'), {}).rules ?? [];
  const current = readJson(target(), {}).rules ?? [];
  if (args[0] !== 'apply') {
    return out([`narvai guard: ${shipped.length} shipped rule(s), ${current.length} of your own`,
      ...shipped.map((r) => `  ${r.id}${r.fixed ? '  (fixed)' : ''}`), ...current.map((r) => `  ${r.id}  (yours)`),
      lastChangeLine(), `change your rules: edit ${defaultSource() ?? '~/.narvai/guard.rules.mjs'}, then narvai guard apply`]);
  }
  const file = args[1] ? resolve(args[1]) : defaultSource();
  if (!file || !existsSync(file)) throw new Error('no rule source: narvai guard apply <file.mjs|file.json>, or keep one at ~/.narvai/guard.rules.mjs');
  const rules = await load(file);
  const errs = problems(rules, shipped.map((r) => r.id));
  if (errs.length) throw new Error(`rules not applied: ${errs.join('; ')}`);
  const d = difference(current, rules);
  if (describe(d) === 'no difference') return out(`narvai guard: your rules already match ${file}`);
  backup(target());
  writeJson(target(), { rules });
  appendFileSync(logFile(), JSON.stringify({ at: new Date().toISOString(), by: harness(), source: file, ...d }) + '\n');
  out([`narvai guard: ${rules.length} rule(s) of your own now in force`, describe(d)]);
}
