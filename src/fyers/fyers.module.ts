import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../common/crypto/crypto.module.js';
import { FyersAuthController } from './fyers-auth.controller.js';
import { FyersAuthService } from './fyers-auth.service.js';
import { FyersClient } from './fyers.client.js';
import { FyersCredential } from './fyers-credential.entity.js';
import { FyersOauthState } from './fyers-oauth-state.entity.js';

@Module({
  imports: [
    CryptoModule,
    TypeOrmModule.forFeature([FyersOauthState, FyersCredential]),
  ],
  controllers: [FyersAuthController],
  providers: [FyersAuthService, FyersClient],
  // Exported so the future InternalModule can inject FyersAuthService
  // without re-declaring the repositories.
  exports: [FyersAuthService],
})
export class FyersModule {}
