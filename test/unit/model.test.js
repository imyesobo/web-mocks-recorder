import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInteraction, normalizeHeaders } from '../../src/model.js';
import { createRecorder } from '../../src/recorder.js';

const fixedNow = () => new Date('2026-01-01T00:00:00.000Z');

test('headers: lower-cased, sorted, ordinary repeated values stay comma-combined', () => {
  const h = new Headers();
  h.append('X-B', '1');
  h.append('X-A', 'a');
  h.append('Set-Cookie', 'a=1; Path=/');
  h.append('Set-Cookie', 'b=2; Path=/');
  h.append('X-B', '2');
  const out = normalizeHeaders(h);
  assert.deepEqual(Object.keys(out), ['set-cookie', 'x-a', 'x-b']);
  assert.deepEqual(out['set-cookie'], ['a=1; Path=/', 'b=2; Path=/']);
  assert.deepEqual(out['x-b'], ['1, 2']);
});

test('interaction: absent body is null, empty body is empty string', async () => {
  const i = await createInteraction({
    executionId: 'e', source: 'wtr', now: fixedNow,
    request: new Request('http://x/a', { method: 'get' }),
    response: new Response(null, { status: 204 }),
  });
  assert.equal(i.request.body, null);
  assert.equal(i.response.body, null);
  assert.equal(i.timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(i.request.method, 'GET');
  assert.equal(i.diagnostics, undefined);
});

test('interaction: empty present body is an empty string', async () => {
  const i = await createInteraction({
    executionId: 'e', source: 'wtr',
    request: new Request('http://x/a', { method: 'POST', body: '' }),
    response: new Response('ok'),
  });
  assert.equal(i.request.body, '');
});

test('interaction: binary body yields null body and a diagnostic', async () => {
  const i = await createInteraction({
    executionId: 'e', source: 'wtr',
    request: new Request('http://x/a', { method: 'POST', body: new Uint8Array([0xff, 0xfe]) }),
    response: new Response('ok'),
  });
  assert.equal(i.request.body, null);
  assert.equal(i.response.body, 'ok');
  assert.equal(i.diagnostics.length, 1);
  assert.equal(i.diagnostics[0].target, 'request.body');
});

test('interaction: unreadable (already consumed) body yields UNREADABLE_PAYLOAD', async () => {
  const response = new Response('x');
  await response.text();
  const i = await createInteraction({
    executionId: 'e', source: 'wtr',
    request: new Request('http://x/a'), response,
  });
  assert.equal(i.response.body, null);
  assert.equal(i.diagnostics[0].code, 'UNREADABLE_PAYLOAD');
});

test('recorder: attaches passively, drains, never throws, detaches', async () => {
  const listeners = new Set();
  const worker = { events: { on: (_, fn) => listeners.add(fn), removeListener: (_, fn) => listeners.delete(fn) } };
  const messages = [];
  const recorder = createRecorder({ source: 'wtr', executionId: 'id', onDiagnostic: m => messages.push(m) });
  recorder.attach(worker);
  const emit = (request, response) => [...listeners].forEach(fn => fn({ request, response }));
  const response = new Response('{"a":1}', { headers: { 'content-type': 'application/json' } });
  emit(new Request('http://x/a', { method: 'POST', body: 'b' }), response);
  assert.equal(await response.text(), '{"a":1}'); // original still readable
  emit({}, {}); // malformed event must not throw
  const out = await recorder.drain();
  assert.equal(out.length, 1);
  assert.equal(out[0].executionId, 'id');
  assert.equal(out[0].response.body, '{"a":1}');
  assert.equal(messages.length, 1);
  recorder.requeue(out);
  assert.deepEqual(await recorder.drain(), out);
  assert.deepEqual(await recorder.drain(), []);
  recorder.detach();
  assert.equal(listeners.size, 0);
});

test('interaction: story is set only when provided', async () => {
  const input = {
    executionId: 'e', source: 'storybook', now: fixedNow,
    request: new Request('http://x/a'),
    response: new Response(null, { status: 204 }),
  };
  assert.equal('story' in await createInteraction(input), false);
  const story = { id: 'a--b', title: 'A', name: 'B', fileName: './a.stories.js' };
  assert.deepEqual((await createInteraction({ ...input, story })).story, story);
});
