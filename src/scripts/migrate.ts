import pino from 'pino';
import dataSource from '../data-source.js';

// Standalone script — runs outside Nest, so it can't inject ScopedLogger.
// A bare pino instance emits the same JSON shape (minus reqId, which is
// expected per the "no reqId outside a request" guardrail) so migration
// lines appear in the same log stream as the server's.
const logger = pino({
  base: { service: 'dwarpal', env: process.env.APP_ENV ?? 'local' },
});

async function main(): Promise<void> {
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });

  await Promise.race([
    dataSource.destroy(),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err, event: 'migration.failed' }, 'Migration failed');
    process.exit(1);
  });
