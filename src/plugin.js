import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { COMMANDS } from './commands.js';
import { createInteractionWriter } from './writer.js';

/**
 * WTR plugin that persists interactions recorded by `recordInteractions()`.
 *
 * Opt-in: enabled only when `enabled: true` or env `WEB_MOCKS_RECORDER=1`. When disabled the commands report
 * `enabled: false`, nothing is written and no directory is created.
 *
 * Output: `<outputDir>/wtr/<test file path relative to rootDir>.<producer>.openapi.json`, one OpenAPI 3
 * document per test file **per producer** (empty recordings are not written). A "producer" groups interactions
 * by the request URL's hostname plus its first `pathSegments` path segments (default `1`), so interactions
 * recorded against different backends/APIs within the same test file land in separate documents instead of
 * being merged into one.
 *
 * The OpenAPI spec is generated from an in-memory HAR 1.2 document by `har-to-openapi` (default `openApi: true`).
 * That in-memory document is only persisted to a `<...>.har` file when `har` is enabled (default `false`). A
 * conversion failure never fails the run: a diagnostic is recorded.
 *
 * @param {{ enabled?: boolean, outputDir?: string, rootDir?: string, executionId?: string, pathSegments?: number, openApi?: boolean, har?: boolean }} [options]
 */
export function recorderPlugin(options = {}) {
  const enabled = options.enabled ?? ['1', 'true'].includes(process.env.WEB_MOCKS_RECORDER ?? '');
  const openApi = options.openApi ?? true;
  const har = options.har ?? false;
  const outputDir = path.resolve(options.outputDir ?? '.interactions');
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const executionId = options.executionId ?? randomUUID();
  const pathSegments = Number.isInteger(options.pathSegments) ? Math.max(0, options.pathSegments) : 1;
  const writer = createInteractionWriter({ source: 'wtr', outputDir, rootDir, executionId, pathSegments, openApi, har });

  return {
    name: 'web-mocks-recorder',

    async executeCommand({ command, payload, session }) {
      if (command === COMMANDS.CONFIG) return { enabled, executionId };
      if (command !== COMMANDS.SAVE) return undefined;
      if (!enabled) return false;

      const relative = path.relative(rootDir, session.testFile).split(path.sep).join('/').replace(/^(\.\.\/)+/, '');
      return writer.save({ file: relative, interactions: payload?.interactions ?? [], diagnostics: payload?.diagnostics ?? [] });
    },
  };
}
