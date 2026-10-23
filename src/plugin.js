import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COMMANDS } from './commands.js';
import { SCHEMA_VERSION } from './model.js';

/**
 * WTR plugin that persists interactions recorded by `recordInteractions()`.
 *
 * Opt-in: enabled only when `enabled: true` or env `WEB_MOCKS_RECORDER=1`. When disabled the commands report
 * `enabled: false`, nothing is written and no directory is created.
 *
 * Output: `<outputDir>/wtr/<test file path relative to rootDir>.interactions.json`, one file per test file
 * (empty recordings are not written).
 *
 * @param {{ enabled?: boolean, outputDir?: string, rootDir?: string, executionId?: string }} [options]
 */
export function recorderPlugin(options = {}) {
  const enabled = options.enabled ?? ['1', 'true'].includes(process.env.WEB_MOCKS_RECORDER ?? '');
  const outputDir = path.resolve(options.outputDir ?? '.interactions');
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const executionId = options.executionId ?? randomUUID();
  /** @type {Map<string, { interactions: object[], diagnostics: string[] }>} */
  const files = new Map();

  return {
    name: 'web-mocks-recorder',

    async executeCommand({ command, payload, session }) {
      if (command === COMMANDS.CONFIG) return { enabled, executionId };
      if (command !== COMMANDS.SAVE) return undefined;
      if (!enabled) return false;

      const testFile = session.testFile;
      const entry = files.get(testFile) ?? { interactions: [], diagnostics: [] };
      files.set(testFile, entry);
      entry.interactions.push(...(payload?.interactions ?? []));
      entry.diagnostics.push(...(payload?.diagnostics ?? []));
      if (!entry.interactions.length) return true;

      const relative = path.relative(rootDir, testFile).split(path.sep).join('/');
      const target = path.join(outputDir, 'wtr', `${relative.replace(/^(\.\.\/)+/, '')}.interactions.json`);
      const document = {
        schemaVersion: SCHEMA_VERSION,
        executionId,
        source: 'wtr',
        testFile: relative,
        interactions: entry.interactions,
        ...(entry.diagnostics.length && { diagnostics: entry.diagnostics }),
      };
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(document, null, 2) + '\n');
      await rename(tmp, target);
      return true;
    },
  };
}
