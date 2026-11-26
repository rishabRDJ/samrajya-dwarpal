import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedPayload {
  encryptedToken: string; // hex
  iv: string; // hex, 24 chars (12 bytes)
  authTag: string; // hex, 32 chars (16 bytes)
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ACTIVE_KEY_VERSION = 1;

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    // Read ONCE at construction. Throwing here means the app fails to boot
    // if the key is malformed — far better than discovering it at the first
    // encrypt call in production.
    const hex = config.getOrThrow<string>('ENCRYPTION_KEY');
    const key = Buffer.from(hex, 'hex');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}`,
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedToken: ciphertext.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      keyVersion: ACTIVE_KEY_VERSION,
    };
  }

  decrypt(payload: EncryptedPayload): string {
    if (payload.keyVersion !== ACTIVE_KEY_VERSION) {
      // Unknown version: we don't have the key to decrypt it. Generic error
      // on purpose — don't leak which version was expected.
      throw new InternalServerErrorException('Decryption failed');
    }
    try {
      const iv = Buffer.from(payload.iv, 'hex');
      const authTag = Buffer.from(payload.authTag, 'hex');
      const ciphertext = Buffer.from(payload.encryptedToken, 'hex');

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag); // MUST be set before .final()

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(), // throws here if the tag doesn't verify
      ]);
      return plaintext.toString('utf8');
    } catch {
      // Swallow the underlying message. A detailed error ("bad tag" vs
      // "bad IV length") is a side channel.
      throw new InternalServerErrorException('Decryption failed');
    }
  }
}
