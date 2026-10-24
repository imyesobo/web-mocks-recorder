import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COMMANDS } from '../../src/commands.js';
import { recorderPlugin } from '../../src/plugin.js';

test('concurrent saves for a test file preserve every interaction', async t => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'wmr-plugin-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const plugin = recorderPlugin({ enabled: true, outputDir, rootDir: '/project' });
  const session = { testFile: '/project/test/example.test.js' };
  const interactions = Array.from({ length: 10 }, (_, index) => ({
    timestamp: `2026-01-01T00:00:0${index}.000Z`,
    request: { method: 'GET', url: `http://example.test/${index}`, headers: {}, body: null },
    response: { status: 200, statusText: 'OK', headers: {}, body: null },
  }));

  await Promise.all(interactions.map(interaction => plugin.executeCommand({
    command: COMMANDS.SAVE,
    payload: { interactions: [interaction] },
    session,
  })));

  const file = path.join(outputDir, 'wtr/test/example.test.js.har');
  const document = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    document.log.entries.map(entry => entry.request.url).sort(),
    interactions.map(interaction => interaction.request.url).sort(),
  );
});
