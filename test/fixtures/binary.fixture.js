import { expect } from '@esm-bundle/chai';
import { registerMockRoutes, worker } from '@web/mocks/browser.js';
import { http } from '@web/mocks/http.js';
import { recordInteractions } from '../../src/wtr.js';

recordInteractions(worker);

it('keeps working with a binary response', async () => {
  registerMockRoutes(
    http.get('/api/img', () => new Response(new Uint8Array([0xff, 0xfe, 0x00]), { headers: { 'content-type': 'image/png' } })),
  );
  const res = await fetch('/api/img');
  expect((await res.arrayBuffer()).byteLength).to.equal(3);
});
