import { expect } from '@esm-bundle/chai';
import { registerMockRoutes, worker } from '@web/mocks/browser.js';
import { http } from '@web/mocks/http.js';
import { recordInteractions } from '../../src/wtr.js';

recordInteractions(worker);

describe('methods', () => {
  it('records all methods', async () => {
    registerMockRoutes(
      http.get('/api/items', () => Response.json([{ id: 1 }], { headers: { 'x-trace': 'a' } })),
      http.post('/api/items', async ({ request }) => Response.json({ echoed: await request.json() }, { status: 201 })),
      http.put('/api/items/1', () => new Response('updated')),
      http.patch('/api/items/1', () => new Response(null, { status: 204 })),
      http.delete('/api/items/1', () => new Response(null, { status: 204 })),
    );
    const get = await fetch('/api/items', { headers: { accept: 'application/json' } });
    expect(await get.json()).to.deep.equal([{ id: 1 }]);
    const post = await fetch('/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(post.status).to.equal(201);
    expect(await (await fetch('/api/items/1', { method: 'PUT', body: 'new' })).text()).to.equal('updated');
    expect((await fetch('/api/items/1', { method: 'PATCH', body: '{}' })).status).to.equal(204);
    expect((await fetch('/api/items/1', { method: 'DELETE' })).status).to.equal(204);
  });
});
