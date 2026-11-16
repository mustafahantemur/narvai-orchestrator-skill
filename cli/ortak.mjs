import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, matchesGlob, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HARNESS = dirname(dirname(fileURLToPath(import.meta.url)));
export const home = () => process.env.NARVAI_HOME || homedir();
export const cfgPath = () => join(home(), '.narvai', 'config.json');
export const tilde = (p) => p.replace(/^~(?=[\\/]|$)/, home());
export const out = (lines) => console.log([lines].flat().join('\n'));

export const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
export function writeJson(p, v) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}
export const cfg = () => readJson(cfgPath(), {});

export function storeRoot() {
  const r = process.env.AI_HARNESS_MEMORY ?? cfg().storeRoot;
  if (!r) throw new Error(`storeRoot is not set in ${cfgPath()}: run narvai setup`);
  return tilde(r);
}

export const git = (args, cwd) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
export const repoRoot = (cwd = process.cwd()) => git(['rev-parse', '--show-toplevel'], cwd);
const norm = (p) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();

// A worktree that map.json does not list resolves to its main repository.
export function storeFor(repo) {
  const map = readJson(join(storeRoot(), 'map.json'), {});
  const find = (p) => Object.entries(map).find(([r]) => norm(r) === norm(p))?.[1];
  const hit = find(repo);
  if (hit) return hit;
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo);
  return (common && find(dirname(common))) || null;
}

function* walk(dir, rel = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) yield rel + e.name;
    else if (e.name !== '.git' && e.name !== 'node_modules') yield* walk(join(dir, e.name), `${rel}${e.name}/`);
  }
}

export function detectStacks(repo, profilesDir = join(HARNESS, 'profiles')) {
  const left = new Map();
  for (const d of existsSync(profilesDir) ? readdirSync(profilesDir) : []) {
    const p = readJson(join(profilesDir, d, 'profile.json'));
    if (p?.detect?.length) left.set(p.name ?? d, p.detect);
  }
  const found = [];
  if (!left.size) return found;
  for (const f of walk(repo)) {
    for (const [name, globs] of left) if (globs.some((g) => matchesGlob(f, g))) { found.push(name); left.delete(name); }
    if (!left.size) break;
  }
  return found.sort();
}

// CLAUDECODE is measured; CODEX_THREAD_ID comes from the Codex source (commit #10096), not its docs.
export const harness = () => (process.env.CLAUDECODE ? 'claude' : process.env.CODEX_THREAD_ID ? 'codex' : 'unknown');

export function which(x) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [x], { stdio: 'ignore' }); return true; } catch { return false; }
}

export function backup(file) {
  if (!existsSync(file)) return;
  const dir = join(home(), '.narvai', 'backups');
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, join(dir, `${file.split(/[\\/]/).slice(-2).join('_')}.${Date.now()}`));
}

// A temp NARVAI_HOME wins over the real user's app-data variables.
export const appDir = (envVar, ...fallback) => (!process.env.NARVAI_HOME && process.env[envVar]) || join(home(), ...fallback);
export const hermesHome = () => (!process.env.NARVAI_HOME && process.env.HERMES_HOME)
  || (process.platform === 'win32' ? join(appDir('LOCALAPPDATA', 'AppData', 'Local'), 'hermes') : join(home(), '.hermes'));

// One physical copy per skill, in this repo: every agent's skill dir holds junctions (symlinks off Windows) to it.
export const skillTargets = () => [join(home(), '.claude', 'skills'), join(home(), '.agents', 'skills'), join(home(), '.gemini', 'config', 'skills'), join(home(), '.pi', 'agent', 'skills')]
  .filter((d) => existsSync(dirname(d)));
export const sameDir = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };

export function link(src, dst) {
  if (sameDir(src, dst)) return false;
  if (lstatSync(dst, { throwIfNoEntry: false })) {
    const bak = join(home(), '.narvai', 'backups', 'skills', `${dst.split(/[\\/]/).slice(-3).join('_')}.${Date.now()}`);
    mkdirSync(dirname(bak), { recursive: true });
    renameSync(dst, bak);
  }
  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(src, dst, 'junction');
  return true;
}

export async function optional(rel, name) {
  const p = join(HARNESS, rel);
  return existsSync(p) ? (await import(pathToFileURL(p).href))[name] : undefined;
}
