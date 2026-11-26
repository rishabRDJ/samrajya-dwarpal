import { Module } from '@nestjs/common';
import { FyersModule } from '../fyers/fyers.module.js';
import { InternalController } from './internal.controller.js';
import { SystemAuthGuard } from './system-auth.guard.js';

// Internal surface for sibling services (Diwan today). Separate module so
// future internal endpoints (webhooks, health probes with elevated
// privileges, batch triggers) share the same SystemAuthGuard wiring.
@Module({
  imports: [FyersModule],
  controllers: [InternalController],
  providers: [SystemAuthGuard],
})
export class InternalModule {}
