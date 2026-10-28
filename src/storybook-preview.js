import { worker } from '@web/mocks/browser.js';
import { createStorybookRecording } from './storybook.js';

// Guard so that loading this module twice never attaches two listeners to the worker.
const recording = (globalThis.__webMocksRecorderStorybook__ ??= createStorybookRecording({ worker }));

export const decorators = [recording.decorator];

export const withInteractionRecording = recording.decorator;
