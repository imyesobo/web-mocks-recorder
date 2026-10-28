import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { STORYBOOK_ENDPOINTS } from '../../src/commands.js';
import { storybookRecorderConnectMiddleware, storybookRecorderMiddleware } from '../../src/storybook-middleware.js';
import { wdsFinal, viteFinal } from '../../src/storybook-preset.js';
import { storybookRecorderVitePlugin } from '../../src/storybook-vite.js';

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

async function setup(t, options = {}) {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-storybook-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const mw = storybookRecorderMiddleware({ enabled: true, outputDir, rootDir: '/project', ...options });
  return { outputDir, mw };
}

async function call(mw, { method, url, body, headers = {} }) {
  let nextCalls = 0;
  const req = Readable.from([Buffer.from(body ?? '')]);
  req.headers = {
    host: 'localhost',
    origin: 'http://localhost',
    'content-type': 'application/json',
    ...headers,
  };
  const ctx = {
    method,
    path: url,
    url,
    req,
    status: undefined,
    body: undefined,
    set() {},
  };
  await mw(ctx, async () => { nextCalls++; });
  return { ctx, nextCalls };
}

const save = (mw, payload, options = {}) =>
  call(mw, { ...options, method: 'POST', url: STORYBOOK_ENDPOINTS.SAVE, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

const exists = (file) => access(file).then(() => true, () => false);

test('GET config returns enabled state and does not call next', async t => {
  const { mw } = await setup(t);
  const { ctx, nextCalls } = await call(mw, { method: 'GET', url: STORYBOOK_ENDPOINTS.CONFIG });
  const body = JSON.parse(ctx.body);
  assert.equal(body.enabled, true);
  assert.equal(typeof body.executionId, 'string');
  assert.equal(nextCalls, 0);
});

test('unknown paths are passed to next', async t => {
  const { mw } = await setup(t);
  const { nextCalls } = await call(mw, { method: 'GET', url: '/other' });
  assert.equal(nextCalls, 1);
});

test('save writes an OpenAPI file per stories file and producer, and no HAR by default', async t => {
  const { outputDir, mw } = await setup(t);
  const { ctx } = await save(mw, { storiesFile: './stories/example.stories.js', interactions: [interaction] });
  assert.equal(ctx.body, 'true');
  const dir = path.join(outputDir, 'storybook/stories');
  const files = await readdir(dir);
  assert.deepEqual(files, ['example.stories.js.orders.example.com-api.openapi.json']);
  const spec = JSON.parse(await readFile(path.join(dir, files[0]), 'utf8'));
  assert.match(spec.openapi, /^3\./);
  assert.ok(Object.keys(spec.paths).some(p => p.includes('/orders')));
});

test('har option writes a HAR tagged with source, stories file and story', async t => {
  const { outputDir, mw } = await setup(t, { har: true });
  await save(mw, { storiesFile: './stories/example.stories.js', interactions: [interaction] });
  const file = path.join(outputDir, 'storybook/stories/example.stories.js.orders.example.com-api.har');
  const { log } = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(log._source, 'storybook');
  assert.equal(log._storiesFile, 'stories/example.stories.js');
  assert.deepEqual(log.entries[0]._story, { id: story.id, title: story.title, name: story.name });
});

test('disabled recorder responds false and writes nothing', async t => {
  const { outputDir, mw } = await setup(t, { enabled: false });
  const { ctx } = await save(mw, { storiesFile: './stories/example.stories.js', interactions: [interaction] });
  assert.equal(ctx.body, 'false');
  assert.equal(await exists(path.join(outputDir, 'storybook')), false);
});

test('path traversal in storiesFile stays inside the storybook output directory', async t => {
  const { outputDir, mw } = await setup(t);
  await save(mw, { storiesFile: '../../etc/evil.stories.js', interactions: [interaction] });
  const written = await readdir(outputDir, { recursive: true });
  assert.ok(written.some(f => f.endsWith('.openapi.json')));
  for (const f of written) assert.ok(f === 'storybook' || f.startsWith('storybook' + path.sep), f);
  assert.equal(await exists(path.join(path.dirname(outputDir), 'etc')), false);
});

test('invalid JSON returns 400', async t => {
  const { mw } = await setup(t);
  const { ctx } = await save(mw, '{not json');
  assert.equal(ctx.status, 400);
});

test('save rejects cross-origin requests and unsupported content types', async t => {
  const { outputDir, mw } = await setup(t);
  const foreign = await save(mw, payload, {
    headers: { origin: 'https://attacker.example' },
  });
  assert.equal(foreign.ctx.status, 403);
  const unsupported = await save(mw, payload, {
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(unsupported.ctx.status, 415);
  assert.equal(await exists(path.join(outputDir, 'storybook')), false);
});

test('oversized save responds 413 without destroying the request', async t => {
  const { mw } = await setup(t);
  const req = new EventEmitter();
  req.headers = { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' };
  let destroyCalls = 0;
  req.destroy = () => { destroyCalls++; };
  const ctx = { method: 'POST', path: STORYBOOK_ENDPOINTS.SAVE, req, set() {} };
  const response = mw(ctx, async () => {});
  req.emit('data', Buffer.alloc(50 * 1024 * 1024 + 1));
  req.emit('data', Buffer.alloc(1));
  req.emit('end');
  await response;
  assert.equal(ctx.status, 413);
  assert.equal(destroyCalls, 0);
});

test('wdsFinal appends exactly one middleware and keeps existing ones', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-storybook-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const existing = async (_ctx, next) => next();
  const config = await wdsFinal({ plugins: [], middleware: [existing] }, { outputDir, enabled: true });
  assert.equal(config.middleware.length, 2);
  assert.equal(config.middleware[0], existing);
  assert.equal(typeof config.middleware[1], 'function');
  const fresh = await wdsFinal({ plugins: [] }, { outputDir, enabled: true });
  assert.equal(fresh.middleware.length, 1);
});

async function connectCall(mw, { method, url, body, headers = {} }) {
  const req = Readable.from([Buffer.from(body ?? '')]);
  req.method = method;
  req.url = url;
  req.headers = {
    host: 'localhost',
    origin: 'http://localhost',
    'content-type': 'application/json',
    ...headers,
  };
  let nextCalls = 0;
  let touched = false;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { touched = true; this.headers[k.toLowerCase()] = v; },
    end(b) { touched = true; this.body = b; finish(); },
  };
  mw(req, res, () => { nextCalls++; finish(); });
  await done;
  return { res, nextCalls, touched };
}

const payload = { storiesFile: './stories/example.stories.js', interactions: [interaction] };
const connectSave = (mw, body) =>
  connectCall(mw, { method: 'POST', url: STORYBOOK_ENDPOINTS.SAVE, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('connect: GET config (also with a query string) returns enabled state', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-storybook-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const mw = storybookRecorderConnectMiddleware({ enabled: true, outputDir, rootDir: '/project' });
  for (const url of [STORYBOOK_ENDPOINTS.CONFIG, `${STORYBOOK_ENDPOINTS.CONFIG}?x=1`]) {
    const { res, nextCalls } = await connectCall(mw, { method: 'GET', url });
    const body = JSON.parse(res.body);
    assert.equal(body.enabled, true);
    assert.equal(typeof body.executionId, 'string');
    assert.equal(nextCalls, 0);
  }
});

test('connect: unknown path calls next once and does not write the response', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-storybook-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const mw = storybookRecorderConnectMiddleware({ enabled: true, outputDir, rootDir: '/project' });
  const { nextCalls, touched } = await connectCall(mw, { method: 'GET', url: '/other' });
  assert.equal(nextCalls, 1);
  assert.equal(touched, false);
});

test('connect: POST save writes the OpenAPI file, invalid JSON gives 400', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-storybook-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const mw = storybookRecorderConnectMiddleware({ enabled: true, outputDir, rootDir: '/project' });
  const { res } = await connectSave(mw, payload);
  assert.equal(String(res.body), 'true');
  assert.ok(await exists(path.join(outputDir, 'storybook', 'stories', 'example.stories.js.orders.example.com-api.openapi.json')));
  const bad = await connectSave(mw, '{nope');
  assert.equal(bad.res.statusCode, 400);
});

test('connect: disabled recorder answers false and writes nothing', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-storybook-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const mw = storybookRecorderConnectMiddleware({ enabled: false, outputDir, rootDir: '/project' });
  const { res } = await connectSave(mw, payload);
  assert.equal(String(res.body), 'false');
  assert.equal(await exists(path.join(outputDir, 'storybook')), false);
});

test('vite plugin: metadata, config and configureServer', () => {
  const plugin = storybookRecorderVitePlugin({ enabled: true });
  assert.equal(plugin.name, 'web-mocks-recorder:storybook');
  assert.equal(plugin.apply, 'serve');
  const cfg = plugin.config({});
  assert.ok(cfg.resolve.dedupe.includes('@web/mocks'));
  assert.ok(cfg.optimizeDeps.include.includes('@web/mocks/browser.js'));
  assert.equal(plugin.config({ optimizeDeps: { exclude: ['@web/mocks'] } }).optimizeDeps, undefined);
  const used = [];
  plugin.configureServer({ middlewares: { use: (fn) => used.push(fn) } });
  assert.equal(used.length, 1);
  assert.equal(typeof used[0], 'function');
});

test('viteFinal appends one plugin, is idempotent and does not mutate the input', async () => {
  const existing = { name: 'existing' };
  const input = { plugins: [existing] };
  const out = await viteFinal(input, { enabled: true });
  assert.equal(input.plugins.length, 1);
  assert.equal(out.plugins[0], existing);
  assert.equal(out.plugins.length, 2);
  assert.equal(out.plugins[1].name, 'web-mocks-recorder:storybook');
  const again = await viteFinal(out, { enabled: true });
  assert.equal(again.plugins.filter((p) => p.name === 'web-mocks-recorder:storybook').length, 1);
});

test('viteFinal reads addon options from presetsList instead of Storybook options', async t => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'wmr-storybook-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const presetObj = {};
  const out = await viteFinal.call(presetObj, {}, {
    outputDir: '/sb-cache',
    presetsList: [{ preset: presetObj, options: { enabled: true, outputDir: tmp, rootDir: '/project' } }],
  });
  const used = [];
  out.plugins[0].configureServer({ middlewares: { use: (fn) => used.push(fn) } });
  const { res } = await connectSave(used[0], payload);
  assert.equal(String(res.body), 'true');
  assert.ok(await exists(path.join(tmp, 'storybook', 'stories', 'example.stories.js.orders.example.com-api.openapi.json')));
});
