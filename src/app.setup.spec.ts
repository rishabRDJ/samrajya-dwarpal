import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';

// The @nestjs/swagger mock must be registered BEFORE any import of
// app.setup.ts — otherwise setup.ts would load the real SwaggerModule
// and try to call app.getHttpAdapter() on our dummy app.
jest.unstable_mockModule('@nestjs/swagger', () => {
  const builderChain = {
    setTitle() {
      return this;
    },
    setDescription() {
      return this;
    },
    setVersion() {
      return this;
    },
    addBearerAuth() {
      return this;
    },
    build() {
      return {};
    },
  };
  return {
    DocumentBuilder: jest.fn(() => builderChain),
    SwaggerModule: {
      setup: jest.fn(),
      createDocument: jest.fn(() => ({})),
    },
  };
});

describe('setupSwagger', () => {
  let setupSwagger: (
    app: INestApplication,
    appEnv: string,
  ) => void;
  let SwaggerModule: { setup: jest.Mock };

  beforeAll(async () => {
    ({ SwaggerModule } = (await import('@nestjs/swagger')) as unknown as {
      SwaggerModule: { setup: jest.Mock };
    });
    ({ setupSwagger } = await import('./app.setup.js'));
  });

  beforeEach(() => {
    SwaggerModule.setup.mockClear();
  });

  it('disables Try it out (supportedSubmitMethods: []) when APP_ENV is production', () => {
    setupSwagger({} as INestApplication, 'production');
    const call = SwaggerModule.setup.mock.calls[0];
    expect(call[0]).toBe('docs');
    const options = call[3] as { swaggerOptions?: { supportedSubmitMethods?: string[] } };
    expect(options?.swaggerOptions?.supportedSubmitMethods).toEqual([]);
  });

  it('leaves Try it out enabled on preview', () => {
    setupSwagger({} as INestApplication, 'preview');
    expect(SwaggerModule.setup.mock.calls[0][3]).toBeUndefined();
  });

  it('leaves Try it out enabled on local', () => {
    setupSwagger({} as INestApplication, 'local');
    expect(SwaggerModule.setup.mock.calls[0][3]).toBeUndefined();
  });
});
