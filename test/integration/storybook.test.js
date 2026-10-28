import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

function runWtr(env) {
  const out = mkdtempSync(path.join(tmpdir(), 'wmr-sb-'));
  const result = spawnSync(
    'npx',
    ['wtr', '--config', 'test/fixtures/storybook/web-test-runner.storybook.config.mjs'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, OUTPUT_DIR: out, ...env } },
  );
  return { out, result };
}

function listFiles(out, prefix, extension) {
  const dir = path.join(out, 'storybook');
  return readdirSync(dir, { recursive: true })
    .map(entry => entry.replace(/\\/g, '/'))
    .filter(entry => entry.startsWith(prefix) && entry.endsWith(extension));
}

function findHar(out, prefix) {
  const matches = listFiles(out, prefix, '.har');
  assert.equal(matches.length, 1, `expected exactly one HAR for "${prefix}", found: ${matches.join(', ')}`);
  const doc = JSON.parse(readFileSync(path.join(out, 'storybook', matches[0]), 'utf8'));
  return { doc, name: matches[0] };
}

test('storybook recording writes one HAR and OpenAPI spec per stories file', t => {
  const { out, result } = runWtr({ WEB_MOCKS_RECORDER: '1' });
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(result.status, 0, result.stdout + result.stderr);

  for (const [prefix, url, id] of [
    ['stories/example.stories.js.', /\/api\/items$/, 'example--default'],
    ['stories/other.stories.js.', /\/api\/other$/, 'other--default'],
  ]) {
    const { doc, name } = findHar(out, prefix);
    assert.equal(doc.log._source, 'storybook');
    assert.equal(doc.log.entries.length, 1);
    assert.match(doc.log.entries[0].request.url, url);
    assert.equal(doc.log.entries[0]._story.id, id);
    assert.equal(doc.log.entries[0]._source, 'storybook');
    assert.ok(
      existsSync(path.join(out, 'storybook', name.replace(/\.har$/, '.openapi.json'))),
      `expected an OpenAPI spec next to ${name}`,
    );
  }
});

test('storybook recording disabled produces no output and tests still pass', t => {
  const { out, result } = runWtr({ WEB_MOCKS_RECORDER: '0' });
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(path.join(out, 'storybook')), false);
});
