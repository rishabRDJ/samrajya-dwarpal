import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service.js';

// Standalone module so any feature that needs AES-GCM encryption can import
// CryptoModule and inject EncryptionService — no circular wiring through
// AppModule.
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
