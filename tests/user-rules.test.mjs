import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { denied } from '../hooks/guard.mjs';
import { readJson } from '../cli/ortak.mjs';

// The author's own rule file, when a path to it is given: NARVAI_USER_RULES=<guard.json> node --test
const file = process.env.NARVAI_USER_RULES;
test('user rules: app start, watch and Azure DevOps writes', { skip: !(file && existsSync(file)) && 'set NARVAI_USER_RULES to a guard.json' }, () => {
  const list = readJson(file).rules;
  const idFor = (command, tool = 'Bash') => denied({ tool, command, paths: [], cwd: '.' }, list)?.id;
  const blocked = {
    'dotnet run --project src/Api': 'app-run', 'dotnet.exe run': 'app-run', 'dotnet watch': 'app-run', 'npm run dev': 'app-run', 'pnpm dev': 'app-run',
    'yarn start': 'app-run', 'npx next dev': 'app-run', 'npm --prefix web run dev': 'app-run', 'npm run-script dev': 'app-run', 'cd web && pnpm dev': 'app-run',
    'tsc --watch': 'watch-build', 'az pipelines run --name ci': 'ado-cli-write', 'az boards work-item update --id 1': 'ado-cli-write',
    'az repos pr update --id 3 --auto-complete true': 'ado-cli-write',
    'az repos pr update --id 3 --status abandoned --description "pr create"': 'ado-cli-write',
    'az boards work-item update --id 1 --title "pr create flow"': 'ado-cli-write',
    'az rest --method post --uri https://dev.azure.com/x': 'ado-rest-write', 'az devops invoke --area build --http-method POST': 'ado-rest-write',
  };
  for (const [c, id] of Object.entries(blocked)) assert.equal(idFor(c), id, c);
  for (const c of ['dotnet build -nodeReuse:false', 'dotnet test', 'npm run build', 'npm test', 'npm run dev:check', 'git push origin feat/x', 'docker compose ps', 'docker ps', 'docker compose -f x.yml up -d --build', 'docker start redis',
    'az repos pr create --title t --source-branch a', 'az pipelines runs list', 'az boards work-item show --id 1', 'vitest run --watch=false',
    'git commit -m "docs: never npm run dev from agents"', 'grep -rn "npm start|dotnet run" docs', 'az rest --method get --uri https://dev.azure.com/x']) {
    assert.equal(idFor(c), undefined, c);
  }
  const mcp = (tool, input) => denied({ tool, command: JSON.stringify(input), paths: [], cwd: '.' }, list)?.id;
  assert.equal(mcp('mcp__azure-devops__pipelines_write', { action: 'run_pipeline' }), 'ado-mcp-write');
  assert.equal(mcp('mcp__azure-devops__wiki_upsert_page', {}), 'ado-mcp-write');
  assert.equal(mcp('mcp__azure-devops__repo_pull_request_write', { action: 'vote' }), 'ado-mcp-pr');
  assert.equal(mcp('mcp__azure-devops__repo_pull_request_write', { action: 'create' }), undefined);
  assert.equal(mcp('mcp__azure-devops__pipelines_run', { action: 'list' }), undefined);
  assert.equal(mcp('mcp__azure-devops__wit_work_item', { action: 'get' }), undefined);
});
