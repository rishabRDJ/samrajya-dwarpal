import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service.js';

const makeService = (hexKey: string) =>
  new EncryptionService({
    getOrThrow: () => hexKey,
  } as unknown as ConfigService);

const KEY_A = randomBytes(32).toString('hex');
const KEY_B = randomBytes(32).toString('hex');

describe('EncryptionService', () => {
  it('round-trips a token', () => {
    const svc = makeService(KEY_A);
    const payload = svc.encrypt('my-fyers-access-token');
    expect(svc.decrypt(payload)).toBe('my-fyers-access-token');
  });

  it('fails to decrypt with a different key', () => {
    const payload = makeService(KEY_A).encrypt('secret');
    expect(() => makeService(KEY_B).decrypt(payload)).toThrow(
      'Decryption failed',
    );
  });

  it('fails when ciphertext is tampered', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    p.encryptedToken = p.encryptedToken.replace(/^.{2}/, '00');
    expect(() => svc.decrypt(p)).toThrow('Decryption failed');
  });

  it('fails when iv is tampered', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    p.iv = p.iv.replace(/^.{2}/, '00');
    expect(() => svc.decrypt(p)).toThrow('Decryption failed');
  });

  it('fails when authTag is tampered', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    p.authTag = p.authTag.replace(/^.{2}/, '00');
    expect(() => svc.decrypt(p)).toThrow('Decryption failed');
  });

  it('rejects an unknown keyVersion', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    expect(() => svc.decrypt({ ...p, keyVersion: 99 })).toThrow(
      'Decryption failed',
    );
  });

  it('produces a fresh IV per call (no nonce reuse)', () => {
    const svc = makeService(KEY_A);
    const a = svc.encrypt('same');
    const b = svc.encrypt('same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedToken).not.toBe(b.encryptedToken);
  });

  it('boot fails if the key is the wrong length', () => {
    expect(() => makeService('ab'.repeat(16))).toThrow(); // 32 hex chars → 16 bytes
  });
});
