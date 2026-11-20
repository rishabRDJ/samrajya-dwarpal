/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UserRole } from '../users/user.entity.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  it('maps the JWT payload into { id, role } that Passport attaches to req.user', async () => {
    const configMock = {
      getOrThrow: jest.fn(() => 'a'.repeat(48)) as any,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    const strategy = moduleRef.get(JwtStrategy);

    const result = strategy.validate({ sub: 'user-123', role: UserRole.ADMIN });
    expect(result).toEqual({ id: 'user-123', role: UserRole.ADMIN });
  });
});
