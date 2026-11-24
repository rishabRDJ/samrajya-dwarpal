import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';

export interface BuildPinoOptionsInput {
  appEnv: string;
  logLevel?: string;
  // Optional override for tests: when provided, pino writes JSON to this
  // destination (an in-memory stream, a file, etc.) instead of stdout.
  // Not used in production.
  destination?: unknown;
}

// A request ID worth keeping. Letters, digits and hyphens only; length between
// 8 and 64 inclusive. Narrow enough to stop header injection; wide enough to
// accept UUIDs, nanoid, short hashes and the request-id values upstream
// services tend to generate.
const REQUEST_ID_REGEX = /^[A-Za-z0-9-]{8,64}$/;

// Paths whose status-200 request logs are not worth keeping. Health pings
// from Render/uptime monitors would otherwise be the majority of lines.
const SILENCED_PATHS = new Set(['/health', '/']);

// Every field name whose VALUE must never appear in logs. Pino's paths option
// supports dot paths and the `*` wildcard; the strings below cover:
//   * headers that carry tokens or session state,
//   * password-like fields we own in DTOs,
//   * token-like fields anywhere in the tree,
// with `*` at the top so arbitrarily nested shapes still match.
const REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.refreshToken',
  '*.accessToken',
  '*.tokenHash',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'tokenHash',
];

function pickHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  // Node coerces duplicate headers into an array of strings; keep only the
  // first for request-id purposes (the same header twice is already weird).
  return Array.isArray(raw) ? raw[0] : raw;
}

// buildPinoOptions is factored out of AppModule so it can be unit-tested
// without booting Nest. It returns the Params nestjs-pino consumes.
export function buildPinoOptions(input: BuildPinoOptionsInput): Params {
  const level = input.logLevel ?? 'info';
  const isLocal = input.appEnv === 'local';

  const pinoHttp: Params['pinoHttp'] = {
    level,
    base: { service: 'dwarpal', env: input.appEnv },
    // Request-id generator. Reuses a trustworthy incoming header; otherwise
    // mints a new UUID. The pino-http contract: whatever this returns is
    // placed on req.id AND emitted as the reqId field on every log line in
    // this request's async context.
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const incoming = pickHeader(req, 'x-request-id');
      const id =
        typeof incoming === 'string' && REQUEST_ID_REGEX.test(incoming)
          ? incoming
          : randomUUID();
      // Echo the chosen id back to the client so every error report can be
      // cross-referenced with the server logs.
      res.setHeader('x-request-id', id);
      return id;
    },
    customAttributeKeys: {
      reqId: 'reqId',
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Serialise request/response minimally. We never log bodies; for the
    // request line we drop the query string because GET /v1/auth/availability
    // carries usernames and email addresses in it.
    serializers: {
      req: (req: IncomingMessage & { url?: string; id?: unknown }) => {
        const pathOnly =
          typeof req.url === 'string' ? req.url.split('?')[0] : req.url;
        return {
          id: req.id,
          method: req.method,
          url: pathOnly,
        };
      },
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    autoLogging: {
      ignore: (req: IncomingMessage) => {
        const url = typeof req.url === 'string' ? req.url.split('?')[0] : '';
        return SILENCED_PATHS.has(url);
      },
    },
    redact: {
      paths: REDACTION_PATHS,
      censor: '[REDACTED]',
      remove: false,
    },
    // pino-pretty makes local terminals readable; everywhere else emits raw
    // JSON. Preview + production never pretty-print — those lines go to a
    // log aggregator eventually and prettification would break parsing.
    ...(isLocal
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss.l',
              colorize: true,
            },
          },
        }
      : {}),
  };

  // Tests pass a destination (e.g. an in-memory stream) so the test can
  // read the JSON pino emits. nestjs-pino accepts a `[options, stream]`
  // tuple here to route pino-http through an explicit stream; attaching
  // a `stream` property on the options object alone is ignored.
  if (input.destination) {
    return {
      pinoHttp: [
        pinoHttp,
        input.destination as Parameters<typeof import('pino')>[1],
      ] as unknown as Params['pinoHttp'],
    };
  }

  return { pinoHttp };
}

// Exported for tests that need to assert the regex independently.
export { REQUEST_ID_REGEX, SILENCED_PATHS, REDACTION_PATHS };
