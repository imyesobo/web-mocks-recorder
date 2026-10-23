import { executeServerCommand } from '@web/test-runner-commands';
import { createRecorder } from './recorder.js';
import { COMMANDS } from './commands.js';

/**
 * Call once at the top level of a WTR test file that uses `@web/mocks/browser.js`.
 *
 *   import { worker } from '@web/mocks/browser.js';
 *   recordInteractions(worker);
 *
 * Recording is controlled by the server-side plugin (see `plugin.js`). When disabled, no listener is attached
 * and nothing is sent. Recorder failures never fail a test.
 *
 * @param {{ events: { on: Function, removeListener: Function } }} worker
 */
export function recordInteractions(worker) {
  /** @type {ReturnType<typeof createRecorder> | undefined} */
  let recorder;
  const diagnostics = [];
  const warn = message => {
    diagnostics.push(message);
    console.warn(message);
  };

  before(async () => {
    try {
      const config = await executeServerCommand(COMMANDS.CONFIG);
      if (!config?.enabled) return;
      recorder = createRecorder({ source: 'wtr', executionId: config.executionId, onDiagnostic: warn });
      recorder.attach(worker);
    } catch (error) {
      warn(`[web-mocks-recorder] disabled, could not initialise: ${error?.message ?? error}`);
    }
  });

  afterEach(async () => {
    if (!recorder) return;
    try {
      const interactions = await recorder.drain();
      const batchDiagnostics = diagnostics.splice(0);
      if (interactions.length || batchDiagnostics.length) {
        await executeServerCommand(COMMANDS.SAVE, { interactions, diagnostics: batchDiagnostics });
      }
    } catch (error) {
      warn(`[web-mocks-recorder] could not persist interactions: ${error?.message ?? error}`);
    }
  });

  after(() => recorder?.detach());
}
