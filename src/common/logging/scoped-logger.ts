import { Injectable, Scope } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

// Each business log line carries `context: 'ClassName.method'` so grep/
// filter queries like `context:"AuthService.login"` work the same across
// Dwarpal, Diwan and Darbar. ScopedLogger wraps PinoLogger so no call site
// has to format that string by hand — and so `reqId` from the current
// AsyncLocalStorage context rides along automatically.
//
// Guardrails, intentionally stated here so a future contributor doesn't
// retune this against the grain of the design:
//
//  1. Never mark this class with Scope.REQUEST. That would propagate up to
//     every consuming service — AuthService, UsersService, AdminUsersService
//     would all be re-instantiated on every request. TRANSIENT is safe:
//     the parent singleton keeps its one private ScopedLogger forever and
//     `reqId` is still correct because PinoLogger reads it from
//     AsyncLocalStorage on every call.
//  2. Lines logged OUTSIDE a request have no reqId. Startup, data-source
//     init, migrate.js, future cron workers — all expected. For workers,
//     attach a correlation field yourself (trade_id, batch_id, …).
//  3. AsyncLocalStorage can be lost in callback-style code that bridges out
//     of the request's async context (older driver callbacks, EventEmitters
//     created outside the request). Nothing in Dwarpal does this today.
//     If a line that should have reqId doesn't, that bridge is the first
//     place to look.
@Injectable({ scope: Scope.TRANSIENT })
export class ScopedLogger {
  private className = 'unknown';

  constructor(private readonly logger: PinoLogger) {}

  forClass(name: string): this {
    this.className = name;
    return this;
  }

  // Returns a small per-method facade. The caller passes event + data; this
  // builds { context: 'ClassName.method', reqId?, event, ...data } and
  // routes to the right pino level. Errors go via `err` so pino's std error
  // serializer captures `message`, `stack`, `code` without the caller
  // spreading them.
  //
  // `reqId` is read at log-call time from the underlying pino child
  // logger's bindings — pino-http creates a child with `req: {id, ...}`
  // per request, so grabbing `req.id` is the one hop that gives us a
  // stable top-level `reqId` field on every business log line within a
  // request. Outside a request (startup, workers) req is undefined and
  // reqId is simply omitted — see guardrail (2) in the class doc.
  in(method: string) {
    const context = `${this.className}.${method}`;
    const log = this.logger;
    const buildBase = (): Record<string, unknown> => {
      const reqId = this.currentReqId();
      // Omit reqId entirely when there isn't one so test assertions that
      // match exact call shapes stay stable OUTSIDE a request context.
      return reqId ? { context, reqId } : { context };
    };
    return {
      info(event: string, data?: Record<string, unknown>): void {
        log.info({ ...buildBase(), event, ...data });
      },
      warn(event: string, data?: Record<string, unknown>): void {
        log.warn({ ...buildBase(), event, ...data });
      },
      debug(event: string, data?: Record<string, unknown>): void {
        log.debug({ ...buildBase(), event, ...data });
      },
      error(event: string, err: unknown, data?: Record<string, unknown>): void {
        log.error({ ...buildBase(), event, err, ...data });
      },
    };
  }

  // Pulls the current request id out of the per-request child logger's
  // bindings. nestjs-pino does not expose an official API for this so we
  // reach through PinoLogger → the underlying pino instance → .bindings().
  // Returns undefined cleanly whenever we're outside a request.
  private currentReqId(): string | undefined {
    const underlying = (this.logger as unknown as { logger?: { bindings?: () => Record<string, unknown> } }).logger;
    const bindings = underlying?.bindings?.();
    const req = bindings?.req as { id?: unknown } | undefined;
    return typeof req?.id === 'string' ? req.id : undefined;
  }
}
