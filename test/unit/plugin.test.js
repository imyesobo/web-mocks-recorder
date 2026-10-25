import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COMMANDS } from '../../src/commands.js';
import { recorderPlugin } from '../../src/plugin.js';

test('concurrent saves to the same producer preserve every interaction', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-plugin-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const plugin = recorderPlugin({ enabled: true, outputDir, rootDir: '/project', har: true });
  const session = { testFile: '/project/test/example.test.js' };
  const interactions = Array.from({ length: 10 }, (_, index) => ({
    timestamp: `2026-01-01T00:00:0${index}.000Z`,
    request: { method: 'GET', url: `http://example.test/items/${index}`, headers: {}, body: null },
    response: { status: 200, statusText: 'OK', headers: {}, body: null },
  }));

  await Promise.all(interactions.map(interaction => plugin.executeCommand({
    command: COMMANDS.SAVE,
    payload: { interactions: [interaction] },
    session,
  })));

  const file = path.join(outputDir, 'wtr/test/example.test.js.example.test-items.har');
  const document = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    document.log.entries.map(entry => entry.request.url).sort(),
    interactions.map(interaction => interaction.request.url).sort(),
  );
  assert.deepEqual(document.log._producer, { host: 'example.test', pathPrefix: '/items' });
});

test('interactions to different producers are written to separate HAR files', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-plugin-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const plugin = recorderPlugin({ enabled: true, outputDir, rootDir: '/project', har: true });
  const session = { testFile: '/project/test/example.test.js' };
  const interactions = [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      request: { method: 'GET', url: 'https://orders.example.com/api/orders/1', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null },
    },
    {
      timestamp: '2026-01-01T00:00:01.000Z',
      request: { method: 'GET', url: 'https://users.example.com/api/users/1', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null },
    },
    {
      timestamp: '2026-01-01T00:00:02.000Z',
      request: { method: 'GET', url: 'https://orders.example.com/admin/health', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null },
    },
  ];

  await plugin.executeCommand({ command: COMMANDS.SAVE, payload: { interactions }, session });

  const ordersApi = JSON.parse(
    await readFile(path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-api.har'), 'utf8'),
  );
  const usersApi = JSON.parse(
    await readFile(path.join(outputDir, 'wtr/test/example.test.js.users.example.com-api.har'), 'utf8'),
  );
  const ordersAdmin = JSON.parse(
    await readFile(path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-admin.har'), 'utf8'),
  );

  assert.deepEqual(ordersApi.log.entries.map(entry => entry.request.url), ['https://orders.example.com/api/orders/1']);
  assert.deepEqual(usersApi.log.entries.map(entry => entry.request.url), ['https://users.example.com/api/users/1']);
  assert.deepEqual(ordersAdmin.log.entries.map(entry => entry.request.url), ['https://orders.example.com/admin/health']);
});

test('by default only the OpenAPI spec is written, no HAR file', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-plugin-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const plugin = recorderPlugin({ enabled: true, outputDir, rootDir: '/project' });
  const session = { testFile: '/project/test/example.test.js' };

  await plugin.executeCommand({ command: COMMANDS.SAVE, payload: { interactions: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      request: { method: 'GET', url: 'https://orders.example.com/api/orders/1', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: { 'content-type': ['application/json'] }, body: '{"id":1}' },
    },
  ] }, session });

  const spec = JSON.parse(await readFile(path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-api.openapi.json'), 'utf8'));
  assert.match(spec.openapi, /^3\./);
  assert.ok(spec.paths['/api/orders/1'].get);
  assert.equal(spec.info.title, 'orders.example.com/api API');
  assert.match(spec.info.description, /web-mocks-recorder from @web\/mocks interactions recorded by "test\/example\.test\.js"/);
  await assert.rejects(
    readFile(path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-api.har'), 'utf8'),
    /ENOENT/,
  );
});

test('har: true writes the HAR file alongside the OpenAPI spec', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-plugin-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const plugin = recorderPlugin({ enabled: true, outputDir, rootDir: '/project', har: true });
  const session = { testFile: '/project/test/example.test.js' };

  await plugin.executeCommand({ command: COMMANDS.SAVE, payload: { interactions: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      request: { method: 'GET', url: 'https://orders.example.com/api/orders/1', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null },
    },
  ] }, session });

  const document = JSON.parse(await readFile(path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-api.har'), 'utf8'));
  assert.equal(document.log.entries[0].request.url, 'https://orders.example.com/api/orders/1');
  const spec = JSON.parse(await readFile(path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-api.openapi.json'), 'utf8'));
  assert.match(spec.openapi, /^3\./);
});

test('openApi: false writes no OpenAPI spec, only the HAR when enabled', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-plugin-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const plugin = recorderPlugin({ enabled: true, outputDir, rootDir: '/project', openApi: false, har: true });
  const session = { testFile: '/project/test/example.test.js' };

  await plugin.executeCommand({ command: COMMANDS.SAVE, payload: { interactions: [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      request: { method: 'GET', url: 'https://orders.example.com/api/orders/1', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null },
    },
  ] }, session });

  const har = path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-api.har');
  assert.ok(await readFile(har, 'utf8'));
  await assert.rejects(
    readFile(path.join(outputDir, 'wtr/test/example.test.js.orders.example.com-api.openapi.json'), 'utf8'),
    /ENOENT/,
  );
});

test('pathSegments: 0 groups purely by host, ignoring the path', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-plugin-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const plugin = recorderPlugin({ enabled: true, outputDir, rootDir: '/project', pathSegments: 0, har: true });
  const session = { testFile: '/project/test/example.test.js' };
  const interactions = [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      request: { method: 'GET', url: 'https://example.com/api/orders/1', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null },
    },
    {
      timestamp: '2026-01-01T00:00:01.000Z',
      request: { method: 'GET', url: 'https://example.com/admin/health', headers: {}, body: null },
      response: { status: 200, statusText: 'OK', headers: {}, body: null },
    },
  ];

  await plugin.executeCommand({ command: COMMANDS.SAVE, payload: { interactions }, session });

  const file = path.join(outputDir, 'wtr/test/example.test.js.example.com.har');
  const document = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(document.log.entries.length, 2);
  assert.deepEqual(document.log._producer, { host: 'example.com', pathPrefix: '' });
});
