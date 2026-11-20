import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';

// Runtime values are loaded lazily inside beforeAll so the throttler mock
// from jest-e2e.setup.ts is applied before anything resolves @nestjs/throttler.
let Test: typeof import('@nestjs/testing').Test;
let request: any;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ TestAppModule } = await import('./test-app.module.js'));
  });

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
