import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { STORYBOOK_ENDPOINTS } from './commands.js';
import { createInteractionWriter } from './writer.js';

const MAX_BODY_BYTES = 50 * 1024 * 1024;

/**
 * Normalises a Storybook `parameters.fileName` into a POSIX path relative to `rootDir` that can never escape
 * the output directory.
 *
 * @param {string} rootDir
 * @param {string} fileName
 */
export function toStoriesFile(rootDir, fileName) {
  const relative = path
    .relative(rootDir, path.resolve(rootDir, fileName.replace(/^\.\//, '')))
    .split(path.sep)
    .join('/')
    .replace(/^(\.\.\/)+/, '');
  return relative && relative !== '..' ? relative : 'unknown-stories';
}

class BodyTooLargeError extends Error {}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function respond(ctx, status, body) {
  ctx.status = status;
  ctx.type = 'application/json';
  ctx.body = JSON.stringify(body);
}

function isSameOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : '') ||
      (req.socket?.encrypted ? 'https' : 'http');
    if (protocol !== 'http' && protocol !== 'https') return false;
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

/**
 * Framework-agnostic request handler shared by the Koa (WDS) and Connect (Vite) adapters. Resolves to
 * `undefined` when the request is not for the recorder, otherwise to `{ status, body }` (body is JSON-encoded by
 * the adapter). Accepts the same options as `recorderPlugin`; output goes to `<outputDir>/storybook/`. Unlike WTR,
 * recording is on by default (registering the addon is the opt-in); disable it with `enabled: false` or
 * `WEB_MOCKS_RECORDER=0`.
 *
 * @param {{ enabled?: boolean, outputDir?: string, rootDir?: string, executionId?: string, pathSegments?: number, openApi?: boolean, har?: boolean }} [options]
 */
export function createStorybookRecorderHandler(options = {}) {
  const enabled = options.enabled ?? !['0', 'false'].includes(process.env.WEB_MOCKS_RECORDER ?? '');
  const openApi = options.openApi ?? true;
  const har = options.har ?? false;
  const outputDir = path.resolve(options.outputDir ?? '.interactions');
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const executionId = options.executionId ?? randomUUID();
  const pathSegments = Number.isInteger(options.pathSegments) ? Math.max(0, options.pathSegments) : 1;
  const writer = createInteractionWriter({ source: 'storybook', outputDir, rootDir, executionId, pathSegments, openApi, har });

  return async function handle({ method, pathname, req }) {
    if (method === 'GET' && pathname === STORYBOOK_ENDPOINTS.CONFIG) {
      return { status: 200, body: { enabled, executionId } };
    }
    if (method !== 'POST' || pathname !== STORYBOOK_ENDPOINTS.SAVE) {
      return undefined;
    }
    if (!enabled) {
      return { status: 200, body: false };
    }
    if (!isSameOrigin(req)) {
      return { status: 403, body: false };
    }
    const contentType = req.headers?.['content-type'];
    if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return { status: 415, body: false };
    }

    try {
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          return { status: 413, body: false };
        }
        return { status: 400, body: false };
      }
      if (typeof payload?.storiesFile !== 'string') {
        return { status: 400, body: false };
      }
      const saved = await writer.save({
        file: toStoriesFile(rootDir, payload.storiesFile),
        interactions: Array.isArray(payload.interactions) ? payload.interactions : [],
        diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
      });
      return { status: 200, body: Boolean(saved) };
    } catch (error) {
      console.warn(`[web-mocks-recorder] Failed to save Storybook interactions: ${error?.message ?? error}`);
      return { status: 500, body: false };
    }
  };
}

/**
 * Koa-style middleware (WDS `config.middleware`) that persists interactions recorded from Storybook stories.
 * Accepts the same options as `recorderPlugin`; output goes to `<outputDir>/storybook/`.
 *
 * @param {Parameters<typeof createStorybookRecorderHandler>[0]} [options]
 */
export function storybookRecorderMiddleware(options = {}) {
  const handle = createStorybookRecorderHandler(options);
  return async (ctx, next) => {
    const result = await handle({ method: ctx.method, pathname: ctx.path, req: ctx.req });
    if (!result) {
      return next();
    }
    respond(ctx, result.status, result.body);
  };
}

/**
 * Connect-style middleware (Vite `configureServer`) with the same behaviour as `storybookRecorderMiddleware`.
 * Reads the request body itself, so no body parser may consume the stream beforehand.
 *
 * @param {Parameters<typeof createStorybookRecorderHandler>[0]} [options]
 */
export function storybookRecorderConnectMiddleware(options = {}) {
  const handle = createStorybookRecorderHandler(options);
  return (req, res, next) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    handle({ method: req.method, pathname, req })
      .then((result) => {
        if (!result) {
          return next();
        }
        if (res.headersSent || res.writableEnded) {
          return undefined;
        }
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result.body));
        return undefined;
      })
      .catch(next);
  };
}
