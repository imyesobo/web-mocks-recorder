import { playwrightLauncher } from '@web/test-runner-playwright';
import { mockPlugin } from '@web/mocks/plugins.js';
import { wdsFinal } from '../../../src/storybook-preset.js';

// Driven by test/integration: OUTPUT_DIR selects where recordings go, WEB_MOCKS_RECORDER toggles recording.
const base = {
  nodeResolve: true,
  rootDir: new URL('../../..', import.meta.url).pathname,
  files: ['test/fixtures/storybook/*.fixture.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
  plugins: [mockPlugin()],
};

export default await wdsFinal({ ...base }, { outputDir: process.env.OUTPUT_DIR, har: true });
