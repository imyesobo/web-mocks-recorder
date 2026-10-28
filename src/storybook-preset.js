import { storybookRecorderMiddleware } from './storybook-middleware.js';
import { storybookRecorderVitePlugin, VITE_PLUGIN_NAME } from './storybook-vite.js';

/**
 * Storybook preset supporting both `@web/storybook-builder` (`wdsFinal`) and `@storybook/builder-vite`
 * (`viteFinal`). The preview part is added by Storybook through the `./storybook/preview` package export,
 * so `previewAnnotations` must not be exported here (it would load the preview twice).
 *
 * The exports are regular functions because Storybook calls them with `this` bound to the preset object.
 */

/**
 * Storybook merges its own options (e.g. `outputDir`) into the preset options, so the addon options are read
 * from the entry of `presetsList` that belongs to this preset when available.
 *
 * @param {any} presetThis preset object Storybook bound as `this`
 * @param {any} options options received by the preset function
 */
function pickAddonOptions(presetThis, options) {
  const own = presetThis ? options?.presetsList?.find((p) => p.preset === presetThis)?.options : undefined;
  const { enabled, outputDir, rootDir, executionId, pathSegments, openApi, har } = own ?? options ?? {};
  return { enabled, outputDir, rootDir, executionId, pathSegments, openApi, har };
}

/**
 * @param {any} config WDS config
 * @param {{ enabled?: boolean, outputDir?: string, rootDir?: string, executionId?: string, pathSegments?: number, openApi?: boolean, har?: boolean }} [options] addon options
 */
export async function wdsFinal(config, options = {}) {
  config.middleware = [
    ...(config.middleware ?? []),
    storybookRecorderMiddleware(pickAddonOptions(this, options)),
  ];
  return config;
}

/**
 * @param {any} config Vite config
 * @param {{ enabled?: boolean, outputDir?: string, rootDir?: string, executionId?: string, pathSegments?: number, openApi?: boolean, har?: boolean }} [options] addon options
 */
export async function viteFinal(config, options = {}) {
  const plugins = config.plugins ?? [];
  if (plugins.flat(Infinity).some((p) => p?.name === VITE_PLUGIN_NAME)) return config;
  return { ...config, plugins: [...plugins, storybookRecorderVitePlugin(pickAddonOptions(this, options))] };
}
