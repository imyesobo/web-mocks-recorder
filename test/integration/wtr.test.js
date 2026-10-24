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

  const doc = read('wtr/test/fixtures/methods.fixture.js.har');
  assert.equal(doc.log.version, '1.2');
  assert.equal(doc.log.creator.name, 'web-mocks-recorder');
  assert.equal(doc.log._source, 'wtr');
  const byMethod = Object.fromEntries(doc.log.entries.map(entry => [entry.request.method, entry]));
  assert.deepEqual(Object.keys(byMethod).sort(), ['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
  for (const entry of doc.log.entries) {
    assert.equal(entry._executionId, doc.log._executionId);
    assert.equal(entry._source, 'wtr');
    assert.ok(!Number.isNaN(Date.parse(entry.startedDateTime)));
    assert.deepEqual(Object.keys(entry.timings), ['blocked', 'dns', 'connect', 'send', 'wait', 'receive', 'ssl']);
  }

  const get = byMethod.GET;
  assert.match(get.request.url, /\/api\/items$/);
  assert.deepEqual(get.request.headers.find(header => header.name === 'accept'), {
    name: 'accept',
    value: 'application/json',
  });
  assert.equal(get.response.status, 200);
  assert.equal(get.response.content.text, '[{"id":1}]');
  assert.deepEqual(get.response.headers.find(header => header.name === 'x-trace'), { name: 'x-trace', value: 'a' });

  assert.equal(byMethod.POST.request.postData.text, '{"name":"x"}');
  assert.equal(byMethod.POST.response.status, 201);
  assert.equal(byMethod.POST.response.content.text, '{"echoed":{"name":"x"}}');
  assert.equal(byMethod.PUT.request.postData.text, 'new');
  assert.equal(byMethod.PUT.response.content.text, 'updated');
  assert.equal(byMethod.PATCH.request.postData.text, '{}');
  assert.equal(byMethod.DELETE.response.status, 204);
  assert.equal(byMethod.DELETE.response.content.size, 0);
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
  const doc = read('wtr/test/fixtures/binary.fixture.js.har');
  const [entry] = doc.log.entries;
  assert.equal(entry.response.content.size, -1);
  assert.equal(entry.response.content.text, undefined);
  assert.equal(entry._diagnostics[0].code, 'UNSUPPORTED_PAYLOAD');
  assert.equal(entry._diagnostics[0].target, 'response.body');
  assert.match(entry._diagnostics[0].message, /image\/png/);
  assert.match(result.stdout + result.stderr, /UNSUPPORTED_PAYLOAD/);
});
