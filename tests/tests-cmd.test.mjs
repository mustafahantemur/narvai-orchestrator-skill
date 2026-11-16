import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declaredNames, pairTargets, testsFor, untouched } from '../cli/tests.mjs';
import { errorLines } from '../cli/verify.mjs';
import { installHooks, withBlock, withoutBlock } from '../cli/hooks.mjs';

const dotnet = { source: ['**/*.cs'], tests: { paths: ['**/*Tests.cs', 'tests/**'], pairs: [{ from: '(?<name>\\w+)\\.cs$', to: '${name}Tests.cs' }] }, ignore: ['**/Migrations/'] };
const nextjs = { source: ['**/*.ts', '**/*.tsx'], tests: { paths: ['**/*.test.ts', '**/*.test.tsx'], pairs: [{ from: '(?<name>[\\w.-]+)\\.(?<ext>tsx?)$', to: '${name}.test.${ext}' }] } };

test('pairs map a source path to its test file name', () => {
  assert.deepEqual(pairTargets('src/Orders/OrderService.cs', dotnet.tests.pairs), ['OrderServiceTests.cs']);
  assert.deepEqual(pairTargets('src/features/orders/order-list.tsx', nextjs.tests.pairs), ['order-list.test.tsx']);
  assert.deepEqual(pairTargets('README.md', dotnet.tests.pairs), []);
});

test('declared names skip import specifiers and prefer the name of the file', () => {
  const tsx = "import { type ReactNode, useState } from 'react';\n  type KeyboardEvent,\nexport type OrderListProps = {};\nexport function OrderList() {}\nconst Scope = 1;\n";
  assert.deepEqual(declaredNames('src/order-list.tsx', tsx), ['OrderList']);
  assert.deepEqual(declaredNames('src/Foo.cs', 'public sealed partial class OrderService : IOrderService\n{\n}\ninternal record struct OrderLine(int Id);\n'), ['OrderService', 'OrderLine']);
  assert.deepEqual(declaredNames('src/OrderService.cs', 'public class OrderService\n{\n}\npublic record Command(int Id);'), ['OrderService']);
});

test('tests are found by pair and by a content probe; touched tests are not reported', () => {
  const files = {
    'src/Orders/OrderService.cs': 'public class OrderService\n{\n}',
    'src/Orders/Pricing.cs': 'public static class PriceRules\n{\n}',
    'src/Orders/Lonely.cs': 'public class LonelyThing\n{\n}',
    'src/Orders/Migrations/Init.cs': 'public class Init\n{\n}',
    'tests/Orders/OrderServiceTests.cs': 'public class OrderServiceTests {}',
    'tests/Orders/CheckoutTests.cs': 'var r = PriceRules.For(x); new OrderService();',
  };
  const read = (f) => files[f];
  const all = Object.keys(files);
  const testFiles = all.filter((f) => f.startsWith('tests/'));
  assert.deepEqual(testsFor('src/Orders/OrderService.cs', { profile: dotnet, testFiles, read }).sort(), ['tests/Orders/CheckoutTests.cs', 'tests/Orders/OrderServiceTests.cs']);
  assert.deepEqual(testsFor('src/Orders/Pricing.cs', { profile: dotnet, testFiles, read }), ['tests/Orders/CheckoutTests.cs']);

  const changed = ['src/Orders/OrderService.cs', 'src/Orders/Pricing.cs', 'src/Orders/Lonely.cs', 'src/Orders/Migrations/Init.cs', 'tests/Orders/OrderServiceTests.cs'];
  const r = untouched({ changed, files: all, profiles: [dotnet], read });
  assert.equal(r.sources, 3);
  assert.equal(r.noTest, 1);
  assert.deepEqual(r.rows, [{ src: 'src/Orders/Pricing.cs', tests: ['tests/Orders/CheckoutTests.cs'] }]);
});

test('error lines: compiler and test-runner errors, deduplicated, bounded', () => {
  const msbuild = [
    '  Restore complete (0.5s)',
    'C:\\r\\src\\A.cs(12,5): error CS0246: The type or namespace name \'Foo\' could not be found [C:\\r\\src\\A.csproj]',
    '    1 Warning(s)',
    'C:\\r\\src\\A.cs(12,5): error CS0246: The type or namespace name \'Foo\' could not be found [C:\\r\\src\\A.csproj]',
    'Build FAILED.',
  ].join('\r\n');
  assert.deepEqual(errorLines(msbuild).lines, ["C:\\r\\src\\A.cs(12,5): error CS0246: The type or namespace name 'Foo' could not be found [C:\\r\\src\\A.csproj]"]);
  assert.deepEqual(errorLines(msbuild, 36, 'C:/r').lines, ["src\\A.cs(12,5): error CS0246: The type or namespace name 'Foo' could not be found [src\\A.csproj]"]);

  const vstest = '  Passed X [1 ms]\n  Failed Orders.Tests.OrderServiceTests.Total [5 ms]\n  Error Message:\n   Assert.Equal() Failure: Values differ\n  Expected: 3\n  Actual:   2\n  Stack Trace:\n     at Foo';
  assert.deepEqual(errorLines(vstest).lines.map((l) => l.trim()), ['Failed Orders.Tests.OrderServiceTests.Total [5 ms]', 'Assert.Equal() Failure: Values differ', 'Expected: 3', 'Actual:   2']);

  const tsc = '\x1b[96msrc/a.ts\x1b[0m:3:7 - \x1b[91merror\x1b[0m TS2322: Type \'string\' is not assignable to type \'number\'.\n\nFound 1 error.';
  assert.deepEqual(errorLines(tsc).lines, ["src/a.ts:3:7 - error TS2322: Type 'string' is not assignable to type 'number'."]);

  const eslint = '\nC:\\r\\src\\b.tsx\n  4:10  error  \'x\' is assigned a value but never used  no-unused-vars\n  9:1   warning  Unexpected console  no-console\n';
  assert.deepEqual(errorLines(eslint).lines, ['C:\\r\\src\\b.tsx', "  4:10  error  'x' is assigned a value but never used  no-unused-vars"]);

  const vitest = ' FAIL  src/c.test.ts > cart > totals\nAssertionError: expected 2 to be 3 // Object.is equality\n ❯ src/c.test.ts:8:17\n Test Files  1 failed | 4 passed (5)';
  assert.equal(errorLines(vitest).lines.length, 4);

  assert.deepEqual(errorLines('a\nb\nsomething went wrong').lines, ['a', 'b', 'something went wrong']);
  const many = errorLines(Array.from({ length: 50 }, (_, i) => `x.cs(${i},1): error CS1002: ; expected`).join('\n'), 36);
  assert.equal(many.lines.length, 36);
  assert.equal(many.more, 14);
});

test('hook block editing is idempotent and reversible', () => {
  const user = '#!/bin/sh\ngit lfs post-commit "$@"\n';
  const once = withBlock(user, 'post-commit', 'echo a');
  assert.ok(once.startsWith(user));
  assert.equal(withBlock(once, 'post-commit', 'echo a'), once);
  assert.equal(withBlock(once, 'post-commit', 'echo b'), `${user}# >>> narvai post-commit\necho b\n# <<< narvai post-commit\n`);
  assert.equal(withoutBlock(once, 'post-commit'), user);
  assert.equal(withBlock('', 'pre-commit', 'x'), '#!/bin/sh\n# >>> narvai pre-commit\nx\n# <<< narvai pre-commit\n');
});

function tempRepo() {
  const t = mkdtempSync(join(tmpdir(), 'narvai-hooks-'));
  const repo = join(t, 'repo');
  mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'core.hooksPath', join(t, 'myhooks').replace(/\\/g, '/'));
  const stub = join(t, 'stub.mjs').replace(/\\/g, '/');
  writeFileSync(stub, [
    "import { writeFileSync } from 'node:fs';",
    'const a = process.argv.slice(2);',
    "if (a[0] === 'tests') console.log('STUB tests output');",
    `if (a[0] === 'graph') setTimeout(() => writeFileSync(${JSON.stringify(join(t, 'built.json'))}, JSON.stringify(a)), 3000);`,
  ].join('\n'));
  return { t, repo, g, stub, hooks: join(t, 'myhooks') };
}

test('installer: core.hooksPath, appends to user hooks, keeps their exit status, detaches the graph build, removes cleanly', async () => {
  const { t, repo, g, stub, hooks } = tempRepo();
  mkdirSync(hooks);
  const userPreCommit = '#!/bin/sh\necho user-pre-commit\ntest ! -f block-me\n';
  writeFileSync(join(hooks, 'pre-commit'), userPreCommit);

  const first = installHooks(repo, { cli: stub, graphRepo: 'demo' });
  assert.match(first[0], /myhooks/);
  assert.deepEqual(first.slice(1).map((l) => l.trim().replace(/\s+/g, ' ')), ['installed pre-push', 'installed pre-commit', 'installed post-commit', 'installed post-merge', 'installed post-checkout']);
  assert.ok(readFileSync(join(hooks, 'pre-commit'), 'utf8').startsWith(userPreCommit));
  assert.ok(installHooks(repo, { cli: stub, graphRepo: 'demo' }).slice(1).every((l) => l.includes('unchanged')));

  writeFileSync(join(repo, 'a.txt'), 'a');
  g('add', 'a.txt');
  const t0 = Date.now();
  const commit = spawnSync('git', ['commit', '-q', '-m', 'a'], { cwd: repo, encoding: 'utf8' });
  const took = Date.now() - t0;
  assert.equal(commit.status, 0, commit.stderr);
  assert.match(commit.stdout + commit.stderr, /user-pre-commit[\s\S]*STUB tests output/);
  assert.ok(took < 2500, `commit took ${took} ms; the graph build must not block it`);
  assert.ok(!existsSync(join(t, 'built.json')));
  for (let i = 0; i < 40 && !existsSync(join(t, 'built.json')); i++) await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(JSON.parse(readFileSync(join(t, 'built.json'), 'utf8')), ['graph', 'build', '--only', 'demo', '--head']);

  writeFileSync(join(repo, 'block-me'), '');
  g('add', 'block-me');
  assert.notEqual(spawnSync('git', ['commit', '-q', '-m', 'b'], { cwd: repo }).status, 0, 'a failing user hook still blocks the commit');

  const removed = installHooks(repo, { cli: stub, graphRepo: 'demo', remove: true });
  assert.equal(removed.length, 6);
  assert.equal(readFileSync(join(hooks, 'pre-commit'), 'utf8'), userPreCommit);
  for (const h of ['pre-push', 'post-commit', 'post-merge', 'post-checkout']) assert.ok(!existsSync(join(hooks, h)), h);
});

test('installer: no graph repo means no graph hooks, and an old whole-file pre-push is undone', () => {
  const { repo, g, stub } = tempRepo();
  g('config', '--unset', 'core.hooksPath');
  const dir = join(repo, '.git', 'hooks');
  writeFileSync(join(dir, 'pre-push'), '#!/bin/sh\n# narvai pre-push\nnode x verify --hook\n');
  writeFileSync(join(dir, 'pre-push.local'), '#!/bin/sh\ngit lfs pre-push "$@"\n');
  const lines = installHooks(repo, { cli: stub, graphRepo: null });
  assert.deepEqual(lines.slice(1).map((l) => l.trim().split(/\s+/)[1]), ['pre-push', 'pre-commit']);
  assert.ok(!existsSync(join(dir, 'pre-push.local')));
  const prePush = readFileSync(join(dir, 'pre-push'), 'utf8');
  assert.ok(prePush.startsWith('#!/bin/sh\ngit lfs pre-push "$@"\n# >>> narvai pre-push\n'));
  assert.ok(!prePush.includes('# narvai pre-push\n'));
});
