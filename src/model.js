/**
 * Shared interaction model. Browser-safe (no Node APIs); reused later by Storybook.
 *
 * Conventions (deterministic):
 *  - header names are lower-cased and sorted; Headers-combined values stay comma-combined, while separate Set-Cookie values are preserved when supported
 *  - absent body => `null`; empty-but-present body => `""`
 *  - bodies are stored verbatim as text; they are never parsed or re-serialised
 *  - a body that cannot be safely represented as text is stored as `null` and a diagnostic is attached
 */

export const SCHEMA_VERSION = 1;

export const DIAGNOSTIC_CODES = {
  UNSUPPORTED_PAYLOAD: 'UNSUPPORTED_PAYLOAD',
  UNREADABLE_PAYLOAD: 'UNREADABLE_PAYLOAD',
};

/**
 * @typedef {Record<string, string[]>} HeaderMap
 * @typedef {{ code: string, target: 'request.body' | 'response.body', message: string }} Diagnostic
 * @typedef {{
 *   executionId: string,
 *   source: 'wtr' | 'storybook',
 *   timestamp: string,
 *   request: { method: string, url: string, headers: HeaderMap, body: string | null },
 *   response: { status: number, headers: HeaderMap, body: string | null },
 *   diagnostics?: Diagnostic[],
 * }} Interaction
 */

const TEXT_TYPE = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql)|[^;]*\+(json|xml))/i;

/**
 * @param {Headers} headers
 * @returns {HeaderMap}
 */
export function normalizeHeaders(headers) {
  /** @type {HeaderMap} */
  const out = Object.create(null);
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const [name, value] of headers.entries()) {
    if (name === 'set-cookie' && cookies.length) continue; // entries() would join them
    (out[name.toLowerCase()] ??= []).push(value);
  }
  if (cookies.length) out['set-cookie'] = cookies;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Reads a body from a (cloned) Request/Response without inventing data.
 *
 * @param {Request | Response} message
 * @param {'request.body' | 'response.body'} target
 * @returns {Promise<{ body: string | null, diagnostic?: Diagnostic }>}
 */
export async function readBody(message, target) {
  const contentType = message.headers.get('content-type');
  if (contentType && !TEXT_TYPE.test(contentType)) {
    return {
      body: null,
      diagnostic: {
        code: DIAGNOSTIC_CODES.UNSUPPORTED_PAYLOAD,
        target,
        message: `${target} has unsupported content-type "${contentType}"; body was not recorded.`,
      },
    };
  }
  let bytes;
  try {
    if (message.body === null) return { body: null };
    bytes = new Uint8Array(await message.arrayBuffer());
  } catch (error) {
    return {
      body: null,
      diagnostic: {
        code: DIAGNOSTIC_CODES.UNREADABLE_PAYLOAD,
        target,
        message: `${target} could not be read: ${error instanceof Error ? error.message : 'unknown error'}.`,
      },
    };
  }
  try {
    return { body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return {
      body: null,
      diagnostic: {
        code: DIAGNOSTIC_CODES.UNSUPPORTED_PAYLOAD,
        target,
        message: `${target} is not valid UTF-8 text (${bytes.byteLength} bytes); body was not recorded.`,
      },
    };
  }
}

/**
 * @param {{ executionId: string, source: Interaction['source'], request: Request, response: Response, now?: () => Date }} input
 *   `request` and `response` must be clones the recorder is free to consume.
 * @returns {Promise<Interaction>}
 */
export async function createInteraction({ executionId, source, request, response, now = () => new Date() }) {
  const timestamp = now().toISOString();
  const [req, res] = await Promise.all([
    readBody(request, 'request.body'),
    readBody(response, 'response.body'),
  ]);
  const diagnostics = [req.diagnostic, res.diagnostic].filter(Boolean);
  /** @type {Interaction} */
  const interaction = {
    executionId,
    source,
    timestamp,
    request: {
      method: request.method.toUpperCase(),
      url: request.url,
      headers: normalizeHeaders(request.headers),
      body: req.body,
    },
    response: {
      status: response.status,
      headers: normalizeHeaders(response.headers),
      body: res.body,
    },
  };
  if (diagnostics.length) interaction.diagnostics = /** @type {Diagnostic[]} */ (diagnostics);
  return interaction;
}
