import { createInteraction } from './model.js';

/**
 * Passive recorder. It only listens to the MSW worker events exposed by `@web/mocks/browser.js`
 * and works on clones, so mocked responses and test timing are never altered.
 * It never throws into the caller: failures become diagnostics via `onDiagnostic`.
 *
 * @param {{
 *   source: import('./model.js').Interaction['source'],
 *   executionId?: string,
 *   onDiagnostic?: (message: string) => void,
 * }} options
 */
export function createRecorder({ source, executionId = defaultExecutionId(), onDiagnostic = () => {} }) {
  /** @type {import('./model.js').Interaction[]} */
  let interactions = [];
  /** @type {Set<Promise<void>>} */
  const pending = new Set();
  /** @type {(() => void)[]} */
  const detachers = [];

  /** @param {Request} request @param {Response} response */
  function record(request, response) {
    const task = createInteraction({ executionId, source, request, response })
      .then(interaction => {
        interactions.push(interaction);
        for (const d of interaction.diagnostics ?? []) {
          onDiagnostic(`[web-mocks-recorder] ${d.code}: ${d.message} (${interaction.request.method} ${interaction.request.url})`);
        }
      })
      .catch(error => {
        onDiagnostic(`[web-mocks-recorder] interaction dropped: ${error instanceof Error ? error.message : 'unknown error'}`);
      })
      .finally(() => pending.delete(task));
    pending.add(task);
  }

  return {
    executionId,
    source,
    record,

    /**
     * Subscribe to an MSW worker/server (`worker` export of `@web/mocks/browser.js`).
     * @param {{ events: { on: Function, removeListener: Function } }} worker
     */
    attach(worker) {
      const onMocked = ({ request, response }) => {
        try {
          record(request.clone(), response.clone());
        } catch (error) {
          onDiagnostic(`[web-mocks-recorder] could not clone interaction: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      };
      worker.events.on('response:mocked', onMocked);
      detachers.push(() => worker.events.removeListener('response:mocked', onMocked));
    },

    detach() {
      detachers.splice(0).forEach(d => d());
    },

    /** Waits for in-flight body reads, then returns and clears captured interactions. */
    async drain() {
      while (pending.size) await Promise.all([...pending]);
      const out = interactions;
      interactions = [];
      return out;
    },
  };
}

function defaultExecutionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
