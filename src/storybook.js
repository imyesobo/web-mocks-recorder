import { createRecorder } from './recorder.js';
import { STORYBOOK_ENDPOINTS } from './commands.js';

const UNKNOWN_FILE = 'unknown-stories';

/**
 * Browser-side recording for Storybook. Used by the addon preview (`storybook-preview.js`), but usable on its own.
 * Interactions are tagged with the active story and sent to the Storybook dev server middleware in debounced batches.
 * Nothing is ever thrown into the story: failures become diagnostics and console warnings.
 *
 * @param {{
 *   worker: { events: { on: Function, removeListener: Function } },
 *   fetch?: typeof globalThis.fetch,
 *   flushDelay?: number,
 *   endpoints?: typeof STORYBOOK_ENDPOINTS,
 * }} options
 */
export function createStorybookRecording({ worker, fetch = globalThis.fetch?.bind(globalThis), flushDelay = 500, endpoints = STORYBOOK_ENDPOINTS }) {
  /** @type {import('./model.js').StoryRef | undefined} */
  let currentStory;
  let disabled = false;
  /** @type {string | undefined} */
  let executionId;
  /** @type {string[]} */
  let diagnostics = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let chain = Promise.resolve();

  const warn = message => {
    diagnostics.push(message);
    console.warn(message);
  };

  const recorder = createRecorder({ source: 'storybook', getStory: () => currentStory, onDiagnostic: warn });
  recorder.attach(worker);

  const onMocked = () => {
    if (disabled) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), flushDelay);
  };
  worker.events.on('response:mocked', onMocked);

  function disable() {
    disabled = true;
    clearTimeout(timer);
    recorder.detach();
    worker.events.removeListener('response:mocked', onMocked);
    diagnostics = [];
    return recorder.drain().catch(() => {});
  }

  const ready = (async () => {
    try {
      const response = await fetch(endpoints.CONFIG);
      if (!response.ok) {
        await disable();
        return;
      }
      const config = await response.json();
      if (!config?.enabled) {
        await disable();
        return;
      }
      executionId = config.executionId;
    } catch (error) {
      console.warn(`[web-mocks-recorder] disabled, could not initialise: ${error?.message ?? error}`);
      await disable();
    }
  })();

  function flush() {
    const run = chain.then(doFlush, doFlush);
    chain = run;
    return run;
  }

  async function doFlush() {
    clearTimeout(timer);
    try {
      await ready;
      if (disabled) return;
      const interactions = (await recorder.drain()).map(i => (executionId ? { ...i, executionId } : i));
      /** @type {Map<string, any[]>} */
      const groups = new Map();
      for (const interaction of interactions) {
        const file = interaction.story?.fileName ?? UNKNOWN_FILE;
        if (!groups.has(file)) groups.set(file, []);
        groups.get(file).push(interaction);
      }
      if (!groups.size && diagnostics.length) groups.set(currentStory?.fileName ?? UNKNOWN_FILE, []);

      for (const [storiesFile, batch] of groups) {
        const batchDiagnostics = diagnostics.splice(0);
        if (!batch.length && !batchDiagnostics.length) continue;
        try {
          const response = await fetch(endpoints.SAVE, {
            method: 'POST',
            keepalive: true,
            headers: { 'content-type': 'application/json', accept: 'msw/passthrough' },
            body: JSON.stringify({ storiesFile, interactions: batch, diagnostics: batchDiagnostics }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
          recorder.requeue(batch);
          diagnostics.unshift(...batchDiagnostics);
          console.warn(`[web-mocks-recorder] could not persist interactions: ${error?.message ?? error}`);
        }
      }
    } catch (error) {
      console.warn(`[web-mocks-recorder] could not flush interactions: ${error?.message ?? error}`);
    }
  }

  /** Storybook decorator: tracks the active story. @param {Function} storyFn @param {any} context */
  function decorator(storyFn, context) {
    const next = {
      id: context.id,
      title: context.title,
      name: context.name,
      fileName: context.parameters?.fileName ?? context.title ?? UNKNOWN_FILE,
    };
    if (currentStory && currentStory.fileName !== next.fileName) void flush();
    currentStory = next;
    return storyFn(context);
  }

  globalThis.addEventListener?.('pagehide', () => void flush());

  return { decorator, flush, ready };
}
