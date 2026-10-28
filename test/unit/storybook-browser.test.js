import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStorybookRecording } from '../../src/storybook.js';
import { STORYBOOK_ENDPOINTS } from '../../src/commands.js';

function createWorker() {
  return { events: new EventEmitter() };
}

function mockInteraction(worker, body) {
  worker.events.emit('response:mocked', {
    request: new Request('https://example.test/api/items'),
    response: new Response(body, { headers: { 'content-type': 'text/plain' } }),
  });
}

test('configuration bypasses MSW and oversized batches use an ordinary request', async () => {
  const worker = createWorker();
  const calls = [];
  const recording = createStorybookRecording({
    worker,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url === STORYBOOK_ENDPOINTS.CONFIG
        ? { ok: true, json: async () => ({ enabled: true, executionId: 'run' }) }
        : { ok: true };
    },
  });
  await recording.ready;
  assert.equal(calls[0].options.headers.accept, 'msw/passthrough');

  recording.decorator(() => {}, { id: 'items--primary', title: 'Items', name: 'Primary' });
  mockInteraction(worker, 'x'.repeat(65 * 1024));
  await recording.flush();

  const save = calls.find(call => call.url === STORYBOOK_ENDPOINTS.SAVE);
  assert.ok(save);
  assert.ok(new TextEncoder().encode(save.options.body).byteLength > 64 * 1024);
  assert.equal(save.options.keepalive, undefined);
});

test('pagehide sends a prepared size-limited keepalive batch without waiting for a timer', async t => {
  const originalAddEventListener = globalThis.addEventListener;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const listeners = new Map();
  let scheduledTimers = 0;
  globalThis.addEventListener = (name, listener) => listeners.set(name, listener);
  globalThis.setTimeout = () => {
    scheduledTimers++;
    return scheduledTimers;
  };
  globalThis.clearTimeout = () => {};
  t.after(() => {
    if (originalAddEventListener === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = originalAddEventListener;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  const worker = createWorker();
  let saveRequest;
  let resolveSave;
  const saveDispatched = new Promise(resolve => { resolveSave = resolve; });
  const recording = createStorybookRecording({
    worker,
    fetch: async (url, options) => {
      if (url === STORYBOOK_ENDPOINTS.CONFIG) {
        return { ok: true, json: async () => ({ enabled: true, executionId: 'run' }) };
      }
      saveRequest = options;
      resolveSave();
      return { ok: true };
    },
  });
  await recording.ready;
  recording.decorator(() => {}, { id: 'items--primary', title: 'Items', name: 'Primary' });
  mockInteraction(worker, 'small response');
  listeners.get('pagehide')();

  await Promise.race([saveDispatched, new Promise(resolve => originalSetTimeout(resolve, 100))]);
  assert.ok(saveRequest);
  assert.equal(saveRequest.keepalive, true);
  assert.ok(new TextEncoder().encode(saveRequest.body).byteLength <= 64 * 1024);
  assert.equal(scheduledTimers, 1);
});
