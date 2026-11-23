import { Global, Module } from '@nestjs/common';
import { ScopedLogger } from './scoped-logger.js';

// Marked @Global() so every feature module (auth, users, admin, future
// modules) can inject ScopedLogger without listing LoggingModule in its
// imports. LoggerModule.forRootAsync is still configured by AppModule — it
// provides PinoLogger, which ScopedLogger wraps.
@Global()
@Module({
  providers: [ScopedLogger],
  exports: [ScopedLogger],
})
export class LoggingModule {}
