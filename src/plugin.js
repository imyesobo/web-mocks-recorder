import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COMMANDS } from './commands.js';

/**
 * WTR plugin that persists interactions recorded by `recordInteractions()`.
 *
 * Opt-in: enabled only when `enabled: true` or env `WEB_MOCKS_RECORDER=1`. When disabled the commands report
 * `enabled: false`, nothing is written and no directory is created.
 *
 * Output: `<outputDir>/wtr/<test file path relative to rootDir>.interactions.json`, one file per test file
 * (empty recordings are not written).
 *
 * @param {{ enabled?: boolean, outputDir?: string, rootDir?: string, executionId?: string }} [options]
 */
export function recorderPlugin(options = {}) {
  const enabled = options.enabled ?? ['1', 'true'].includes(process.env.WEB_MOCKS_RECORDER ?? '');
  const outputDir = path.resolve(options.outputDir ?? '.interactions');
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const executionId = options.executionId ?? randomUUID();
  /** @type {Map<string, { interactions: object[], diagnostics: string[] }>} */
  const files = new Map();

  return {
    name: 'web-mocks-recorder',

    async executeCommand({ command, payload, session }) {
      if (command === COMMANDS.CONFIG) return { enabled, executionId };
      if (command !== COMMANDS.SAVE) return undefined;
      if (!enabled) return false;

      const testFile = session.testFile;
      const entry = files.get(testFile) ?? { interactions: [], diagnostics: [] };
      files.set(testFile, entry);
      entry.interactions.push(...(payload?.interactions ?? []));
      entry.diagnostics.push(...(payload?.diagnostics ?? []));
      if (!entry.interactions.length) return true;

      const relative = path.relative(rootDir, testFile).split(path.sep).join('/');
      const target = path.join(outputDir, 'wtr', `${relative.replace(/^(\.\.\/)+/, '')}.har`);
      const document = {
        log: {
          version: '1.2',
          creator: { name: 'web-mocks-recorder', version: '0.1.0' },
          entries: entry.interactions.map(toHarEntry),
          _executionId: executionId,
          _source: 'wtr',
          _testFile: relative,
          ...(entry.diagnostics.length && { _diagnostics: entry.diagnostics }),
        },
      };
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(document, null, 2) + '\n');
      await rename(tmp, target);
      return true;
    },
  };
}

function toHarEntry(interaction) {
  const { request, response } = interaction;
  const requestHeaders = toHarHeaders(request.headers);
  const responseHeaders = toHarHeaders(response.headers);
  const requestBodySize = getBodySize(request.body, interaction.diagnostics, 'request.body');
  const responseBodySize = getBodySize(response.body, interaction.diagnostics, 'response.body');
  const url = new URL(request.url);
  const requestContentType = request.headers['content-type']?.[0] ?? '';
  const responseContentType = response.headers['content-type']?.[0] ?? '';

  return {
    startedDateTime: interaction.timestamp,
    time: -1,
    request: {
      method: request.method,
      url: request.url,
      httpVersion: '',
      cookies: parseRequestCookies(request.headers.cookie ?? []),
      headers: requestHeaders,
      queryString: [...url.searchParams].map(([name, value]) => ({ name, value })),
      headersSize: -1,
      bodySize: requestBodySize,
      ...(request.body !== null && {
        postData: { mimeType: requestContentType, text: request.body },
      }),
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      httpVersion: '',
      cookies: parseResponseCookies(response.headers['set-cookie'] ?? []),
      headers: responseHeaders,
      content: {
        size: responseBodySize,
        mimeType: responseContentType,
        ...(response.body !== null && { text: response.body }),
      },
      redirectURL: response.headers.location?.[0] ?? '',
      headersSize: -1,
      bodySize: responseBodySize,
    },
    cache: {},
    timings: { blocked: -1, dns: -1, connect: -1, send: -1, wait: -1, receive: -1, ssl: -1 },
    _executionId: interaction.executionId,
    _source: interaction.source,
    ...(interaction.diagnostics && { _diagnostics: interaction.diagnostics }),
  };
}

function getBodySize(body, diagnostics, target) {
  if (body === null) return diagnostics?.some(diagnostic => diagnostic.target === target) ? -1 : 0;
  return new TextEncoder().encode(body).byteLength;
}

function toHarHeaders(headers) {
  return Object.entries(headers).flatMap(([name, values]) => values.map(value => ({ name, value })));
}

function parseRequestCookies(values) {
  return values.flatMap(value =>
    value.split(';').map(cookie => cookie.trim()).filter(Boolean).map(cookie => {
      const separator = cookie.indexOf('=');
      return { name: separator < 0 ? cookie : cookie.slice(0, separator), value: separator < 0 ? '' : cookie.slice(separator + 1) };
    }),
  );
}

function parseResponseCookies(values) {
  return values.flatMap(value => {
    const [pair, ...attributes] = value.split(';').map(part => part.trim());
    const separator = pair.indexOf('=');
    if (separator < 0) return [];
    const cookie = { name: pair.slice(0, separator), value: pair.slice(separator + 1) };
    for (const attribute of attributes) {
      const split = attribute.indexOf('=');
      const name = (split < 0 ? attribute : attribute.slice(0, split)).toLowerCase();
      const value = split < 0 ? '' : attribute.slice(split + 1);
      if (name === 'path' || name === 'domain' || name === 'expires') cookie[name] = value;
      else if (name === 'httponly' || name === 'secure') cookie[name] = true;
    }
    return [cookie];
  });
}
