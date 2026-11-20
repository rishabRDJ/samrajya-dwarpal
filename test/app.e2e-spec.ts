import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';

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

const [{ Test }, supertestPkg, testModuleMod] = await Promise.all([
  import('@nestjs/testing'),
  import('supertest'),
  import('./test-app.module.js'),
]);

const request = (supertestPkg as any).default ?? supertestPkg;
const { TestAppModule } = testModuleMod;

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    await app.init();
  });

  it('/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
