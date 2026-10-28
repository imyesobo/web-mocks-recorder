import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { STORYBOOK_ENDPOINTS } from '../../src/commands.js';
import { storybookRecorderVitePlugin } from '../../src/storybook-vite.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fixtureRoot = path.resolve(import.meta.dirname, '../fixtures/vite');

const story = { id: 'example--primary', title: 'Example', name: 'Primary', fileName: './stories/example.stories.js' };
const interaction = {
  timestamp: '2026-01-01T00:00:00.000Z',
  source: 'storybook',
  story,
  request: { method: 'GET', url: 'https://orders.example.com/api/orders/1', headers: {}, body: null },
  response: {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': ['application/json'] },
    body: JSON.stringify({ id: 1 }),
  },
};

async function startVite(t, pluginOptions = {}) {
  const out = await mkdtemp(path.join(tmpdir(), 'wmr-vite-'));
  const server = await createServer({
    configFile: false,
    root: fixtureRoot,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [storybookRecorderVitePlugin({ enabled: true, outputDir: out, rootDir: repoRoot, har: true, ...pluginOptions })],
  });
  t.after(async () => {
    await server.close();
    await rm(out, { recursive: true, force: true });
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  return { server, out, base };
}

const save = (base, body) =>
  fetch(base + STORYBOOK_ENDPOINTS.SAVE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'msw/passthrough' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const exists = p => access(p).then(() => true, () => false);

test('vite: records interactions to OpenAPI and HAR', async t => {
  const { out, base } = await startVite(t);

  const config = await fetch(base + STORYBOOK_ENDPOINTS.CONFIG);
  assert.equal(config.status, 200);
  assert.equal((await config.json()).enabled, true);

  const res = await save(base, { storiesFile: './stories/example.stories.js', interactions: [interaction] });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'true');

  const files = (await readdir(path.join(out, 'storybook', 'stories'))).filter(f => f.startsWith('example.stories.js.'));
  const har = files.find(f => f.endsWith('.har'));
  const openapi = files.find(f => f.endsWith('.openapi.json'));
  assert.ok(har && openapi, `expected HAR and OpenAPI, found: ${files.join(', ')}`);
  const doc = JSON.parse(await readFile(path.join(out, 'storybook', 'stories', har), 'utf8'));
  assert.equal(doc.log._source, 'storybook');
  assert.ok(doc.log.entries[0]._story.id);
});

test('vite: invalid JSON is rejected with 400', async t => {
  const { base } = await startVite(t);
  const res = await save(base, '{not json');
  assert.equal(res.status, 400);
});

test('vite: disabled recorder reports disabled and writes nothing', async t => {
  const { out, base } = await startVite(t, { enabled: false });
  const config = await fetch(base + STORYBOOK_ENDPOINTS.CONFIG);
  assert.equal((await config.json()).enabled, false);
  const res = await save(base, { storiesFile: './stories/example.stories.js', interactions: [interaction] });
  assert.equal(await res.text(), 'false');
  assert.equal(await exists(path.join(out, 'storybook')), false);
});

test('vite: other requests still reach Vite', async t => {
  const { base } = await startVite(t);
  const res = await fetch(base + '/index.html');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /vite-fixture-marker/);
});

test('vite: @web/mocks is deduped between the app and the addon preview', async t => {
  const { server } = await startVite(t);
  assert.ok(server.config.resolve.dedupe.includes('@web/mocks'));
  const strip = id => id.replace(/\?.*$/, '');
  const a = await server.pluginContainer.resolveId('@web/mocks/browser.js', path.join(fixtureRoot, 'main.js'));
  const b = await server.pluginContainer.resolveId('@web/mocks/browser.js', path.resolve(repoRoot, 'src/storybook-preview.js'));
  assert.ok(a && b);
  assert.equal(strip(a.id), strip(b.id));
});
