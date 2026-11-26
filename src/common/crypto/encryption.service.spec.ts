import 'reflect-metadata';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service.js';

const makeService = (hexKey: string): EncryptionService =>
  new EncryptionService({
    getOrThrow: () => hexKey,
  } as unknown as ConfigService);

const KEY_A = randomBytes(32).toString('hex');
const KEY_B = randomBytes(32).toString('hex');

describe('EncryptionService', () => {
  it('round-trips a token', () => {
    const svc = makeService(KEY_A);
    const payload = svc.encrypt('my-fyers-access-token');
    expect(payload.keyVersion).toBe(1);
    expect(svc.decrypt(payload)).toBe('my-fyers-access-token');
  });

  it('fails with a different ENCRYPTION_KEY', () => {
    const payload = makeService(KEY_A).encrypt('secret');
    expect(() => makeService(KEY_B).decrypt(payload)).toThrow(
      InternalServerErrorException,
    );
  });

  it('fails when the ciphertext is changed', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    p.encryptedToken = p.encryptedToken.replace(/^.{2}/, '00');
    expect(() => svc.decrypt(p)).toThrow(InternalServerErrorException);
  });

  it('fails when the iv is changed', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    p.iv = p.iv.replace(/^.{2}/, '00');
    expect(() => svc.decrypt(p)).toThrow(InternalServerErrorException);
  });

  it('fails when the authTag is changed', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    p.authTag = p.authTag.replace(/^.{2}/, '00');
    expect(() => svc.decrypt(p)).toThrow(InternalServerErrorException);
  });

  it('rejects an unknown keyVersion', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    expect(() => svc.decrypt({ ...p, keyVersion: 99 })).toThrow(
      InternalServerErrorException,
    );
  });

  it('produces a fresh IV per call so GCM is never reused with the same key', () => {
    const svc = makeService(KEY_A);
    const a = svc.encrypt('same-plaintext');
    const b = svc.encrypt('same-plaintext');
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedToken).not.toBe(b.encryptedToken);
  });

  it('refuses to construct when the key is not 32 bytes', () => {
    expect(() => makeService('ab'.repeat(16))).toThrow();
  });

  it('never leaks the key material or IV in the generic error message', () => {
    const svc = makeService(KEY_A);
    const p = svc.encrypt('secret');
    p.authTag = '00'.repeat(16);
    try {
      svc.decrypt(p);
      fail('decrypt should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toBe('Decryption failed');
      expect(message).not.toContain(KEY_A);
      expect(message).not.toContain(p.iv);
      expect(message).not.toContain(p.encryptedToken);
    }
  });
});
