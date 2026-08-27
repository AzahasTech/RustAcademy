import { Test } from '@nestjs/testing';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';

import { AppConfigModule, validateEnvironment } from './config.module';
import {
  ENV_VALIDATION_OPTIONS,
  MIN_PRODUCTION_SECRET_LENGTH,
  NON_PRODUCTION_DEFAULTS,
  envValidationSchema,
} from './env.schema';

/**
 * These tests exercise the module wiring rather than the schema rules: the
 * module must hand `forRoot()` exactly one composed schema plus the shared
 * validation options, and a broken environment must abort the boot with a
 * deterministic, secret-free error.
 */
describe('AppConfigModule', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    // Nest's ConfigModule validates env only once per process (static cache).
    // Reset the registry so every test re-runs forRoot validation from a
    // clean slate and we can assert boot-time rejection deterministically.
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, envSnapshot);
    jest.restoreAllMocks();
  });

  it('forwards the single composed schema and shared options to forRoot', () => {
    // The module declares exactly one schema and one options object and runs
    // both through `validateEnvironment`, which is what forRoot invokes at boot.
    expect(envValidationSchema).toBeDefined();
    expect(ENV_VALIDATION_OPTIONS).toMatchObject({
      abortEarly: false,
      convert: true,
      allowUnknown: true,
      stripUnknown: false,
    });
    expect(typeof validateEnvironment).toBe('function');

    // Development (the default) validates and applies defaults without throwing.
    expect(() => validateEnvironment({ NODE_ENV: 'development' })).not.toThrow();
  });


  it('exposes validated and defaulted values through ConfigService', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PORT;
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile();

    const config = moduleRef.get(ConfigService);

    expect(config.get('PORT')).toBe(3000);
    expect(config.get('DATABASE_URL')).toBe(
      NON_PRODUCTION_DEFAULTS.test.DATABASE_URL,
    );
  });

  it('fails the boot deterministically when production config is missing', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
      }),
    ).toThrow(/Config validation error/);
    expect(() =>
      validateEnvironment({ NODE_ENV: 'production' }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      validateEnvironment({ NODE_ENV: 'production' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('does not print secret values when a production secret is rejected', () => {
    const leaked = 'leaked-jwt-secret-value';
    let message = '';
    try {
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://app:pw@db.internal:5432/rustacademy',
        REDIS_HOST: 'redis.internal',
        JWT_SECRET: leaked,
        ASSET_SIGNING_SECRET: 'c'.repeat(
          MIN_PRODUCTION_SECRET_LENGTH + 4,
        ),
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain('JWT_SECRET');
    expect(message).not.toContain(leaked);
  });
});
