// Bir ekosistemin bütün repoları için iki graph'ı da model çağırmadan üretir:
// Graphify (ajanların yapısal haritası, repo başına + birleşik) ve Understand-Anything (kök başına).
// Repo listesi harness'ta değil store'da durur: <storeRoot>/graph/repos.json
// Kullanım: node ekosistem.mjs [--only <repo>] [--skip-graphify] [--skip-ua] [--no-fetch]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

const cfgPath = path.join(os.homedir(), '.narvai', 'config.json');
const storeRoot = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')).storeRoot : null;
if (!storeRoot) {
  console.error(`storeRoot bulunamadı: ${cfgPath}`);
  process.exit(1);
}
const GRAPH = `${storeRoot.replace(/\\/g, '/')}/graph`;
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
const list = readJson(`${GRAPH}/repos.json`);

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (dir, ...args) => {
  try {
    return git(dir, ...args);
  } catch {
    return null;
  }
};
const seconds = (t) => Math.round((Date.now() - t) / 1000);

function syncClone(repo) {
  const clone = `${GRAPH}/${repo.name}`;
  if (!fs.existsSync(`${clone}/.git`)) execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', repo.path, clone]);
  if (!flag('no-fetch') && tryGit(repo.path, 'fetch', '--quiet', 'origin') === null) console.warn(`  uyarı: ${repo.name} origin'den çekilemedi, yerel ref kullanılıyor`);
  const branch = repo.branch || list.branch || 'development';
  const ref =
    [`refs/remotes/origin/${branch}`, 'refs/remotes/origin/HEAD', 'HEAD'].find((r) => tryGit(repo.path, 'rev-parse', '--verify', '--quiet', r) !== null);
  const commit = git(repo.path, 'rev-parse', ref);
  git(clone, 'fetch', '--quiet', repo.path, commit);
  git(clone, 'checkout', '--quiet', '--detach', commit);
  return { clone, commit, ref };
}

function expandRoots(repo, clone) {
  return (repo.roots || [{ path: '.' }]).flatMap((r) => {
    if (!r.path.endsWith('/*')) return [{ ...r, dir: path.posix.basename(r.path === '.' ? repo.name : r.path) }];
    const base = r.path.slice(0, -2);
    if (!fs.existsSync(`${clone}/${base}`)) return [];
    return fs
      .readdirSync(`${clone}/${base}`, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ ...r, path: `${base}/${e.name}`, dir: e.name }));
  });
}

const results = [];
for (const repo of list.repos.filter((r) => !only || r.name === only)) {
  const started = Date.now();
  const row = { repo: repo.name, ua: [], errors: [] };
  results.push(row);
  console.log(`\n== ${repo.name}`);
  let clone;
  try {
    ({ clone, commit: row.commit } = syncClone(repo));
  } catch (e) {
    row.errors.push(`kopya: ${e.message.split('\n')[0]}`);
    continue;
  }
  const ignore = [...(list.ignore || []), ...(repo.ignore || [])];

  if (!flag('skip-graphify')) {
    fs.writeFileSync(`${clone}/.graphifyignore`, ['.ua/', 'graphify-out/', ...ignore, ...(list.graphifyIgnore || [])].join('\n') + '\n');
    const t = Date.now();
    const r = spawnSync('graphify', ['update', clone, '--no-cluster'], { encoding: 'utf8', shell: process.platform === 'win32' });
    const out = `${clone}/graphify-out/graph.json`;
    if (r.status === 0 && fs.existsSync(out)) {
      row.graphify = { graph: path.posix.relative(GRAPH, out), bytes: fs.statSync(out).size, seconds: seconds(t) };
      console.log(`  graphify: ${Math.round(row.graphify.bytes / 1048576)} MB, ${row.graphify.seconds} sn`);
    } else row.errors.push(`graphify: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0]}`);
  }

  if (!flag('skip-ua')) {
    for (const root of expandRoots(repo, clone)) {
      const fill = (s) => (s || '').replaceAll('{dir}', root.dir);
      const dir = root.path === '.' ? clone : `${clone}/${root.path}`;
      const exclude = [...ignore, ...(root.exclude || [])].join(',');
      const r = spawnSync(
        process.execPath,
        [`${HERE}/ua-uret.mjs`, dir, fill(root.name) || repo.name, fill(root.description) || repo.name, '--frameworks', repo.frameworks || '', '--exclude', exclude],
        { encoding: 'utf8' },
      );
      if (r.status === 0) row.ua.push(root.path);
      else row.errors.push(`ua ${root.path}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0]}`);
    }
    console.log(`  understand-anything: ${row.ua.length} kök`);
  }
  row.seconds = seconds(started);
  for (const e of row.errors) console.log(`  HATA ${e}`);
}

const indexPath = `${GRAPH}/index.json`;
const index = fs.existsSync(indexPath) ? readJson(indexPath) : { graphs: [] };
index.graphify = [
  ...(index.graphify || []).filter((g) => !results.some((r) => r.repo === g.repo && r.graphify)),
  ...results.filter((r) => r.graphify).map((r) => ({ repo: r.repo, commit: r.commit, builtAt: new Date().toISOString(), ...r.graphify })),
].sort((a, b) => a.repo.localeCompare(b.repo));

// Birleşik graph her çalıştırmada bütün repolardan yeniden kurulur; tek repo güncellense de eskimez.
if (!flag('skip-graphify') && index.graphify.length > 1) {
  fs.mkdirSync(`${GRAPH}/ekosistem`, { recursive: true });
  const out = `${GRAPH}/ekosistem/graph.json`;
  const r = spawnSync('graphify', ['merge-graphs', ...index.graphify.map((g) => `${GRAPH}/${g.graph}`), '--out', out], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status === 0 && fs.existsSync(out)) index.ecosystem = { graph: 'ekosistem/graph.json', bytes: fs.statSync(out).size, repos: index.graphify.map((g) => g.repo), builtAt: new Date().toISOString() };
  else console.log(`HATA birleşik graph: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0]}`);
}
writeJson(indexPath, index);

const failed = results.filter((r) => r.errors.length);
console.log(`\n${results.length} repo, ${results.reduce((a, r) => a + r.ua.length, 0)} Understand-Anything kökü, ${results.filter((r) => r.graphify).length} Graphify graph'ı, ${failed.length} repoda hata.`);
process.exit(failed.length ? 2 : 0);
