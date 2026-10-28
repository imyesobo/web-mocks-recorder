import { storybookRecorderConnectMiddleware } from './storybook-middleware.js';

export const VITE_PLUGIN_NAME = 'web-mocks-recorder:storybook';

const MOCKS_PACKAGE = '@web/mocks';
const MOCKS_BROWSER = '@web/mocks/browser.js';

/**
 * Vite plugin (dev server only) that mounts the Storybook recorder endpoints. It is a plain object so `vite` is
 * not required at runtime. Accepts the same options as the `wdsFinal` preset hook.
 *
 * @param {{ enabled?: boolean, outputDir?: string, rootDir?: string, executionId?: string, pathSegments?: number, openApi?: boolean, har?: boolean }} [options]
 */
export function storybookRecorderVitePlugin(options = {}) {
  // Created once per plugin instance so server restarts keep the same writer and executionId.
  const middleware = storybookRecorderConnectMiddleware(options);

  return {
    name: VITE_PLUGIN_NAME,
    apply: 'serve',
    config(userConfig) {
      const exclude = userConfig.optimizeDeps?.exclude ?? [];
      const excluded = exclude.includes(MOCKS_PACKAGE) || exclude.includes(MOCKS_BROWSER);
      return {
        resolve: { dedupe: [MOCKS_PACKAGE] },
        // Lets the user's preview and the addon preview share one pre-bundled module (a single MSW worker).
        ...(excluded ? {} : { optimizeDeps: { include: [MOCKS_BROWSER] } }),
      };
    },
    configureServer(server) {
      // Registered directly (not as a post hook) so it runs before Vite's SPA fallback.
      server.middlewares.use(middleware);
    },
  };
}
