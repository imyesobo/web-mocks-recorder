# web-mocks-recorder

Records HTTP interactions exercised through [`@web/mocks`](https://modern-web.dev/docs/dev-server/plugins/mocks/) as HAR 1.2 files. Web Test Runner (WTR) is the source. Storybook, Pact generation and publication come later and will reuse the model in `src/model.js`.

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

`<outputDir>/wtr/<test file path>.har`, one HAR 1.2 file per test file; runs with zero interactions write nothing.

```jsonc
{
  "log": {
    "version": "1.2",
    "creator": { "name": "web-mocks-recorder", "version": "0.1.0" },
    "entries": [{
      "startedDateTime": "ISO-8601",
      "time": -1,
      "request": {
        "method": "POST", "url": "…", "httpVersion": "",
        "cookies": [], "headers": [{ "name": "content-type", "value": "application/json" }],
        "queryString": [], "headersSize": -1, "bodySize": 5,
        "postData": { "mimeType": "application/json", "text": "{…}" }
      },
      "response": {
        "status": 201, "statusText": "", "httpVersion": "",
        "cookies": [], "headers": [], "content": { "size": -1, "mimeType": "" },
        "redirectURL": "", "headersSize": -1, "bodySize": -1
      },
      "cache": {},
      "timings": { "blocked": -1, "dns": -1, "connect": -1, "send": -1, "wait": -1, "receive": -1, "ssl": -1 },
      "_diagnostics": [{ "code": "UNSUPPORTED_PAYLOAD", "target": "response.body", "message": "…" }]
    }],
    "_executionId": "…", "_source": "wtr", "_testFile": "test/a.test.js"
  }
}
```

- HTTP interactions use the standard HAR 1.2 request/response structure. Recorder metadata and diagnostics use HAR-compatible extension fields prefixed with `_`.
- Header names are lower-cased and sorted; repeated values are represented as separate HAR header records.
- Absent bodies are omitted from HAR text fields; empty bodies remain empty strings. Recorded bodies are stored verbatim as text.
- HAR timing, HTTP version and header-size values unavailable to the recorder are marked `-1` or left empty.
- Non-text content types or non-UTF-8 bytes are **not** recorded: the HAR text field is omitted, size is marked unknown, a `_diagnostics` extension is added and a `console.warn` is emitted. Payload contents are never included in diagnostics.

## Behaviour guarantees

The recorder listens passively to MSW's `response:mocked` event and reads clones. Its errors become diagnostics and never fail a test.

## Open decisions (not decided here)

Output naming policy, empty-recording policy (currently: no file), redaction of sensitive headers/bodies (currently: **none applied**), binary encoding.

## Tests

`npm test` runs unit tests and integration tests that drive real WTR runs in Chromium (`npx playwright install chromium` first).
