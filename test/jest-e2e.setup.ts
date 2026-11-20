import 'reflect-metadata';
import { jest } from '@jest/globals';

// Registered before any e2e test module is loaded. @nestjs/throttler has an
// ESM require-cycle that trips Node's VM loader; this shim keeps the controller
// decorator and the module importable without the real package.
jest.unstable_mockModule('@nestjs/throttler', () => ({
  __esModule: true,
  Throttle: () => () => undefined,
  ThrottlerModule: { forRoot: () => ({ module: class {}, providers: [] }) },
  ThrottlerGuard: class {
    canActivate(): boolean {
      return true;
    }
  },
}));
