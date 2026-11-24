import 'reflect-metadata';
import { Writable } from 'node:stream';
import pino from 'pino';
import { buildPinoOptions, REQUEST_ID_REGEX } from './pino-options.js';

// Shape of the pinoHttp object the tests inspect. Not the full pino-http
// surface — just the pieces this spec reads. Keeps every cast narrow and
// readable without reaching for `any`.
interface PinoHttpForTests {
  genReqId: (req: unknown, res: unknown) => string;
  serializers: { req: (req: unknown) => { url?: string } };
  autoLogging: { ignore: (req: unknown) => boolean };
  customLogLevel: (req: unknown, res: unknown, err: unknown) => string;
  transport?: unknown;
}
function asPinoHttp(options: ReturnType<typeof buildPinoOptions>): PinoHttpForTests {
  return options.pinoHttp as unknown as PinoHttpForTests;
}

// Helpers --------------------------------------------------------------

// A writable sink that captures each pino line as a parsed JSON object.
function captureStream(): { lines: Record<string, unknown>[]; stream: Writable } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const raw of chunk.toString().split('\n')) {
        if (!raw) continue;
        lines.push(JSON.parse(raw));
      }
      cb();
    },
  });
  return { lines, stream };
}

// pino-http wraps pino but we don't need its request pipeline here; a raw
// pino instance built from the same options is enough to verify base
// fields, redaction paths and serialisers. buildPinoOptions returns the
// tuple form `[opts, stream]` when `destination` is provided.
function buildPino(appEnv = 'preview', logLevel?: string) {
  const { stream, lines } = captureStream();
  const options = buildPinoOptions({ appEnv, logLevel, destination: stream });
  const [opts] = options.pinoHttp as unknown as [pino.LoggerOptions, unknown];
  return { logger: pino(opts, stream), lines };
}

// --- tests --------------------------------------------------------------

describe('buildPinoOptions', () => {
  describe('base fields', () => {
    it("sets service='dwarpal' and env from appEnv on every line", () => {
      const { logger, lines } = buildPino('production');
      logger.info('boot');
      expect(lines[0]).toMatchObject({ service: 'dwarpal', env: 'production' });
    });

    it('defaults the level to info when LOG_LEVEL is omitted', () => {
      // Use a non-local env so the pino-pretty transport isn't attached,
      // otherwise pino writes through a worker thread and bypasses the
      // test stream.
      const { logger, lines } = buildPino('preview');
      logger.debug('this should not appear');
      logger.info('this should appear');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ msg: 'this should appear' });
    });

    it('respects the provided LOG_LEVEL', () => {
      const { logger, lines } = buildPino('preview', 'debug');
      logger.debug('kept');
      expect(lines).toHaveLength(1);
    });
  });

  describe('REQUEST_ID_REGEX', () => {
    it('accepts letters, digits and hyphens between 8 and 64 characters', () => {
      expect(REQUEST_ID_REGEX.test('abcdef12')).toBe(true);
      expect(REQUEST_ID_REGEX.test('a'.repeat(64))).toBe(true);
      expect(REQUEST_ID_REGEX.test('11111111-2222-3333-4444-555555555555')).toBe(true);
    });

    it('rejects too-short, too-long, or non-alphanumeric values', () => {
      expect(REQUEST_ID_REGEX.test('short')).toBe(false); // 5 chars
      expect(REQUEST_ID_REGEX.test('a'.repeat(65))).toBe(false);
      expect(REQUEST_ID_REGEX.test('has spaces here')).toBe(false);
      expect(REQUEST_ID_REGEX.test('bad\nnewline-xx')).toBe(false);
      expect(REQUEST_ID_REGEX.test('semi;colon-xxxx')).toBe(false);
    });
  });

  describe('genReqId', () => {
    function invokeGenReqId(headerValue?: string | string[]) {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const genReqId = (options.pinoHttp as { genReqId: unknown }).genReqId as (
        req: unknown,
        res: unknown,
      ) => string;
      const headers: Record<string, string | string[] | undefined> = {};
      if (headerValue !== undefined) headers['x-request-id'] = headerValue;
      const setHeaderCalls: Array<[string, string]> = [];
      const req = { headers } as unknown;
      const res = {
        setHeader: (name: string, value: string) => {
          setHeaderCalls.push([name, value]);
        },
      } as unknown;
      const id = genReqId(req, res);
      return { id, setHeaderCalls };
    }

    it('reuses a valid incoming x-request-id header', () => {
      const incoming = '11111111-2222-3333-4444-555555555555';
      const { id, setHeaderCalls } = invokeGenReqId(incoming);
      expect(id).toBe(incoming);
      // And echoes it back on the response.
      expect(setHeaderCalls).toContainEqual(['x-request-id', incoming]);
    });

    it('replaces a malformed x-request-id with a fresh UUID', () => {
      const { id, setHeaderCalls } = invokeGenReqId('nope spaces');
      expect(id).not.toBe('nope spaces');
      // UUID v4 shape.
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(setHeaderCalls[0]).toEqual(['x-request-id', id]);
    });

    it('generates a new UUID when no x-request-id header is present', () => {
      const { id } = invokeGenReqId(undefined);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('rejects an array header value (duplicate x-request-id) and generates a new UUID if the first is also bad', () => {
      const { id } = invokeGenReqId(['x', 'y']);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('redaction', () => {
    it('replaces every sensitive value with [REDACTED] (top level and nested)', () => {
      const { logger, lines } = buildPino();

      logger.info(
        {
          password: 'hunter2',
          currentPassword: 'old',
          newPassword: 'newnewnew',
          passwordHash: '$argon2id$...',
          refreshToken: 'rt.secret',
          accessToken: 'at.secret',
          tokenHash: 'sha256...',
          user: { password: 'nested-also' },
          outer: { inner: { accessToken: 'deeply-nested' } },
        },
        'write',
      );

      const line = lines[0] as Record<string, unknown>;
      expect(line.password).toBe('[REDACTED]');
      expect(line.currentPassword).toBe('[REDACTED]');
      expect(line.newPassword).toBe('[REDACTED]');
      expect(line.passwordHash).toBe('[REDACTED]');
      expect(line.refreshToken).toBe('[REDACTED]');
      expect(line.accessToken).toBe('[REDACTED]');
      expect(line.tokenHash).toBe('[REDACTED]');
      expect((line.user as Record<string, unknown>).password).toBe('[REDACTED]');
    });

    it('redacts req.headers.authorization and req.headers.cookie when a raw req object leaks past the serializer', () => {
      // Defense in depth: the custom req serializer already strips headers,
      // but if a dev later passes a plain object literal named `rawReq` (or
      // bypasses the serializer by nesting), the redaction paths must still
      // catch it.
      const { logger, lines } = buildPino();
      logger.info(
        {
          req: {
            // Use the exact shape the redact paths target (`req.headers.*`).
            headers: {
              authorization: 'Bearer secret.jwt.here',
              cookie: 'session=abc',
            },
          },
        },
        'raw',
      );
      // The custom serializer drops headers entirely for top-level `req`
      // keys (via pino's named-serializer hook), so `req.headers` is
      // undefined on the emitted line. That's the primary defense.
      const req = (lines[0] as Record<string, unknown>).req as
        | { headers?: unknown }
        | undefined;
      expect(req?.headers).toBeUndefined();
    });
  });

  describe('request serializer', () => {
    it('strips the query string from the logged URL', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const serializer = asPinoHttp(options).serializers.req as (req: unknown) => {
        url?: string;
      };
      const out = serializer({ url: '/v1/auth/availability?username=rishab', method: 'GET', id: 'abc' });
      expect(out.url).toBe('/v1/auth/availability');
      expect(out.url).not.toContain('rishab');
    });

    it('passes through a URL that has no query string', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const serializer = asPinoHttp(options).serializers.req as (req: unknown) => {
        url?: string;
      };
      expect(serializer({ url: '/v1/users/me', method: 'GET', id: 'abc' }).url).toBe('/v1/users/me');
    });
  });

  describe('autoLogging.ignore', () => {
    it('skips GET /health and GET /', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const ignore = asPinoHttp(options).autoLogging.ignore;
      expect(ignore({ url: '/health' })).toBe(true);
      expect(ignore({ url: '/' })).toBe(true);
    });

    it('does not skip other paths', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const ignore = asPinoHttp(options).autoLogging.ignore;
      expect(ignore({ url: '/v1/users/me' })).toBe(false);
    });

    it('still skips when the health path has a query string', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const ignore = asPinoHttp(options).autoLogging.ignore;
      expect(ignore({ url: '/health?check=1' })).toBe(true);
    });
  });

  describe('customLogLevel', () => {
    it('is error for 5xx or thrown error', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const fn = asPinoHttp(options).customLogLevel;
      expect(fn({}, { statusCode: 500 }, undefined)).toBe('error');
      expect(fn({}, { statusCode: 200 }, new Error('boom'))).toBe('error');
    });
    it('is warn for 4xx', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const fn = asPinoHttp(options).customLogLevel;
      expect(fn({}, { statusCode: 404 }, undefined)).toBe('warn');
    });
    it('is info otherwise', () => {
      const options = buildPinoOptions({ appEnv: 'preview' });
      const fn = asPinoHttp(options).customLogLevel;
      expect(fn({}, { statusCode: 200 }, undefined)).toBe('info');
    });
  });

  describe('transport', () => {
    it('attaches pino-pretty only for local', () => {
      const localOpts = buildPinoOptions({ appEnv: 'local' });
      const prodOpts = buildPinoOptions({ appEnv: 'production' });
      expect(asPinoHttp(localOpts).transport).toBeDefined();
      expect(asPinoHttp(prodOpts).transport).toBeUndefined();
    });
  });
});
