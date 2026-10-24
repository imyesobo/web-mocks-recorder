# web-mocks-recorder

Records HTTP interactions exercised through [`@web/mocks`](https://modern-web.dev/docs/dev-server/plugins/mocks/) as HAR 1.2 files. Web Test Runner (WTR) is the source. Storybook, Pact generation and publication come later and will reuse the model in `src/model.js`.

## Usage (WTR)

`web-test-runner.config.mjs`
```js
import { mockPlugin } from '@web/mocks/plugins.js';
import { recorderPlugin } from 'web-mocks-recorder/plugin.js';

export default {
  nodeResolve: true,
  plugins: [mockPlugin(), recorderPlugin({ outputDir: '.interactions', pathSegments: 1 })],
};
```
`pathSegments` (default `1`) controls how many leading URL path segments are folded into each producer's grouping key — see [Output](#output).

Test file (one line added; the rest of the test is unchanged):
```js
import { registerMockRoutes, worker } from '@web/mocks/browser.js';
import { recordInteractions } from 'web-mocks-recorder/wtr.js';

recordInteractions(worker);
```

**Call it at the test file's top level — not inside a hook.** `recordInteractions()` registers its own `before`/`afterEach` hooks, so calling it from inside e.g. a `before()` hook means those hooks are never scheduled. That setup fails completely silently: tests pass, no warning is logged, and no HAR file is written.

**Opt-in switch:** recording runs only with `WEB_MOCKS_RECORDER=1` (or `recorderPlugin({ enabled: true })`). When disabled, no listener is attached, nothing is written and no directory is created.

**Splitting by producer:** interactions recorded within a single test file are not all merged into one HAR. They are grouped by **producer** — the request URL's hostname plus its first `pathSegments` path segments (default `1`) — so requests made to different backends/APIs (or different top-level routes on the same backend) land in separate HAR files. The port is ignored when grouping, since dev servers often get a randomly assigned port. Tune the grouping granularity with `recorderPlugin({ pathSegments: 2 })` (`0` groups by hostname only); unparsable URLs fall into a single `unknown` bucket rather than being dropped.

## Output

`<outputDir>/wtr/<test file path>.<producer>.har`, one HAR 1.2 file per test file **per producer**; runs with zero interactions write nothing. For example, a test file that calls both `https://orders.example.com/api/...` and `https://users.example.com/api/...` produces:

```text
.interactions/wtr/test/checkout.test.js.orders.example.com-api.har
.interactions/wtr/test/checkout.test.js.users.example.com-api.har
```

Each document also carries a `_producer: { host, pathPrefix }` extension field describing which producer it contains.

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
    "_executionId": "…", "_source": "wtr", "_testFile": "test/a.test.js",
    "_producer": { "host": "api.example.com", "pathPrefix": "/orders" }
  }
}
```

- HTTP interactions use the standard HAR 1.2 request/response structure. Recorder metadata and diagnostics use HAR-compatible extension fields prefixed with `_`.
- Header names are lower-cased and sorted. Values already comma-combined by `Headers` remain combined; separate `Set-Cookie` values are represented as separate HAR header records where supported.
- Absent bodies are omitted from HAR text fields; empty bodies remain empty strings. Recorded bodies are stored verbatim as text.
- HAR timing, HTTP version and header-size values unavailable to the recorder are marked `-1` or left empty.
- Non-text content types or non-UTF-8 bytes are **not** recorded: the HAR text field is omitted, size is marked unknown, a `_diagnostics` extension is added and a `console.warn` is emitted. Payload contents are never included in diagnostics.

## Behaviour guarantees

The recorder listens passively to MSW's `response:mocked` event and reads clones. Its errors become diagnostics and never fail a test.

## Open decisions (not decided here)

Output naming policy, empty-recording policy (currently: no file), redaction of sensitive headers/bodies (currently: **none applied**), binary encoding.

## Tests

`npm test` runs unit tests and integration tests that drive real WTR runs in Chromium (`npx playwright install chromium` first).
