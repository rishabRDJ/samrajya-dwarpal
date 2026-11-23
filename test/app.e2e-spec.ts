/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';

// Runtime values are loaded lazily inside beforeAll so the throttler mock
// from jest-e2e.setup.ts is applied before anything resolves @nestjs/throttler.
let Test: typeof import('@nestjs/testing').Test;
let request: any;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;
let setupApp: typeof import('../src/app.setup.js').setupApp;

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ TestAppModule } = await import('./test-app.module.js'));
    ({ setupApp } = await import('../src/app.setup.js'));
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // Root is now @Version(VERSION_NEUTRAL): lives at / regardless of API
  // version. (Was /v1 under the old setGlobalPrefix model.)
  it('GET / returns the hello string without a version prefix', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('GET /health responds without a /v1 prefix', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });

  // Acceptance check from PR C Step 2: a versioned URL must NOT exist for
  // handlers marked VERSION_NEUTRAL, so /v1/health is deliberately 404.
  it('GET /v1/health is 404 (health is unversioned)', () => {
    return request(app.getHttpServer()).get('/v1/health').expect(404);
  });
});
