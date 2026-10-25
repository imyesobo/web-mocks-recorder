import { playwrightLauncher } from '@web/test-runner-playwright';
import { mockPlugin } from '@web/mocks/plugins.js';
import { recorderPlugin } from '../../src/plugin.js';

// Driven by test/integration: OUTPUT_DIR selects where recordings go, WEB_MOCKS_RECORDER toggles recording.
export default {
  nodeResolve: true,
  rootDir: new URL('../..', import.meta.url).pathname,
  files: [process.env.FIXTURE_FILES ?? 'test/fixtures/*.fixture.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
  plugins: [mockPlugin(), recorderPlugin({ outputDir: process.env.OUTPUT_DIR, har: true, openApi: false })],
};
