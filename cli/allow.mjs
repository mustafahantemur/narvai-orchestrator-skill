import { allowPath, rules } from '../hooks/guard.mjs';
import { out, readJson, writeJson } from './ortak.mjs';

export default async function run(args) {
  const i = args.indexOf('--minutes');
  const minutes = i >= 0 ? Number(args[i + 1]) : 30;
  const id = args.find((a, j) => !a.startsWith('--') && (i < 0 || j !== i + 1));
  if (!id || !(minutes > 0) || minutes > 480) throw new Error('usage: narvai allow <rule-id> [--minutes n]  (at most 480)');
  // An exception is the user's decision: an agent's shell has no terminal on stdin.
  if (!process.stdin.isTTY) throw new Error('narvai allow is for the user: run it in your own terminal');
  const rule = rules().find((r) => r.id === id);
  if (!rule) throw new Error(`no guard rule ${id}: ids are in hooks/deny.json and ~/.narvai/guard.json`);
  if (rule.fixed) throw new Error(`${id} cannot be lifted`);
  const now = Date.now();
  const allow = Object.fromEntries(Object.entries(readJson(allowPath(), {})).filter(([, t]) => Date.parse(t) > now));
  allow[id] = new Date(now + minutes * 60_000).toISOString();
  writeJson(allowPath(), allow);
  out([`allowed ${id} until ${allow[id]} (${allowPath()})`, `rule: ${rule.reason}`]);
}
