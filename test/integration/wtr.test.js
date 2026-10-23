import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

function runWtr(files, env) {
  const out = mkdtempSync(path.join(tmpdir(), 'wmr-'));
  const result = spawnSync(
    'npx',
    ['wtr', '--config', 'test/fixtures/web-test-runner.config.mjs'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, FIXTURE_FILES: files, OUTPUT_DIR: out, ...env } },
  );
  return { out, result, read: rel => JSON.parse(readFileSync(path.join(out, rel), 'utf8')) };
}

test('recording enabled captures every method and leaves test results unchanged', t => {
  const { out, result, read } = runWtr('test/fixtures/methods.fixture.js', { WEB_MOCKS_RECORDER: '1' });
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const doc = read('wtr/test/fixtures/methods.fixture.js.interactions.json');
  assert.equal(doc.source, 'wtr');
  assert.equal(doc.schemaVersion, 1);
  const byMethod = Object.fromEntries(doc.interactions.map(i => [i.request.method, i]));
  assert.deepEqual(Object.keys(byMethod).sort(), ['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
  for (const i of doc.interactions) {
    assert.equal(i.executionId, doc.executionId);
    assert.equal(i.source, 'wtr');
    assert.ok(!Number.isNaN(Date.parse(i.timestamp)));
  }

  const get = byMethod.GET;
  assert.match(get.request.url, /\/api\/items$/);
  assert.deepEqual(get.request.headers.accept, ['application/json']);
  assert.equal(get.request.body, null);
  assert.equal(get.response.status, 200);
  assert.equal(get.response.body, '[{"id":1}]');
  assert.deepEqual(get.response.headers['x-trace'], ['a']);

  assert.equal(byMethod.POST.request.body, '{"name":"x"}');
  assert.equal(byMethod.POST.response.status, 201);
  assert.equal(byMethod.POST.response.body, '{"echoed":{"name":"x"}}');
  assert.equal(byMethod.PUT.request.body, 'new');
  assert.equal(byMethod.PUT.response.body, 'updated');
  assert.equal(byMethod.PATCH.request.body, '{}');
  assert.equal(byMethod.DELETE.response.status, 204);
  assert.equal(byMethod.DELETE.response.body, null);
});

test('recording disabled produces no output and tests still pass', t => {
  const { out, result } = runWtr('test/fixtures/methods.fixture.js', { WEB_MOCKS_RECORDER: '' });
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(path.join(out, 'wtr')), false);
});

test('unsupported payload is reported, not invented, and does not fail the test', t => {
  const { out, result, read } = runWtr('test/fixtures/binary.fixture.js', { WEB_MOCKS_RECORDER: '1' });
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const doc = read('wtr/test/fixtures/binary.fixture.js.interactions.json');
  const [i] = doc.interactions;
  assert.equal(i.response.body, null);
  assert.equal(i.diagnostics[0].code, 'UNSUPPORTED_PAYLOAD');
  assert.equal(i.diagnostics[0].target, 'response.body');
  assert.match(i.diagnostics[0].message, /image\/png/);
  assert.match(result.stdout + result.stderr, /UNSUPPORTED_PAYLOAD/);
});
