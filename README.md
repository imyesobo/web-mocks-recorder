# web-mocks-recorder

Records HTTP interactions exercised through [`@web/mocks`](https://modern-web.dev/docs/dev-server/plugins/mocks/) into `interactions.json` files. Epic 1, story 1.1: Web Test Runner (WTR) source. Storybook, Pact generation and publication come later and will reuse the model in `src/model.js`.

## Usage (WTR)

`web-test-runner.config.mjs`
```js
import { mockPlugin } from '@web/mocks/plugins.js';
import { recorderPlugin } from 'web-mocks-recorder/plugin.js';

export default {
  nodeResolve: true,
  plugins: [mockPlugin(), recorderPlugin({ outputDir: '.interactions' })],
};
```

Test file (one line added; the rest of the test is unchanged):
```js
import { registerMockRoutes, worker } from '@web/mocks/browser.js';
import { recordInteractions } from 'web-mocks-recorder/wtr.js';

recordInteractions(worker);
```

**Opt-in switch:** recording runs only with `WEB_MOCKS_RECORDER=1` (or `recorderPlugin({ enabled: true })`). When disabled, no listener is attached, nothing is written and no directory is created.

## Output

`<outputDir>/wtr/<test file path>.interactions.json`, one file per test file; runs with zero interactions write nothing.

```jsonc
{
  "schemaVersion": 1, "executionId": "…", "source": "wtr", "testFile": "test/a.test.js",
  "interactions": [{
    "executionId": "…", "source": "wtr", "timestamp": "ISO-8601",
    "request":  { "method": "POST", "url": "…", "headers": { "content-type": ["application/json"] }, "body": "{…}" },
    "response": { "status": 201, "headers": {}, "body": null },
    "diagnostics": [{ "code": "UNSUPPORTED_PAYLOAD", "target": "response.body", "message": "…" }]
  }]
}
```

- Header names are lower-cased and sorted; values are arrays so repeated headers (e.g. `set-cookie`) are lossless.
- Absent body is `null`; empty body is `""`. Bodies are stored verbatim as text.
- Non-text content types or non-UTF-8 bytes are **not** recorded: body is `null`, a `diagnostics` entry is added and a `console.warn` is emitted. Payload contents are never included in diagnostics.

## Behaviour guarantees

The recorder listens passively to MSW's `response:mocked` event and reads clones. Its errors become diagnostics and never fail a test.

## Open decisions (not decided here)

JSON Schema, output naming policy, empty-recording policy (currently: no file), redaction of sensitive headers/bodies (currently: **none applied**), binary encoding.

## Tests

`npm test` runs unit tests and integration tests that drive real WTR runs in Chromium (`npx playwright install chromium` first).
