import { expect } from '@esm-bundle/chai';
import { registerMockRoutes, worker } from '@web/mocks/browser.js';
import { http } from '@web/mocks/http.js';
import { createStorybookRecording } from '../../../src/storybook.js';

const recording = createStorybookRecording({ worker, flushDelay: 50 });

describe('storybook stories', () => {
  it('records interactions per story file', async () => {
    recording.decorator(() => 'ok', {
      id: 'example--default',
      title: 'Example',
      name: 'Default',
      parameters: { fileName: './stories/example.stories.js' },
    });
    registerMockRoutes(http.get('/api/items', () => Response.json([{ id: 1 }])));
    const items = await fetch('/api/items');
    expect(await items.json()).to.deep.equal([{ id: 1 }]);

    recording.decorator(() => 'ok', {
      id: 'other--default',
      title: 'Other',
      name: 'Default',
      parameters: { fileName: './stories/other.stories.js' },
    });
    registerMockRoutes(http.get('/api/other', () => Response.json({ ok: true })));
    const other = await fetch('/api/other');
    expect(await other.json()).to.deep.equal({ ok: true });

    await recording.flush();
  });
});
