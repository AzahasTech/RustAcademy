import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { contractEnvSchema } from './env.schema';

/**
 * Application config module with contract-specific environment
 * variable validation (#395, #396).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: contractEnvSchema.concat(
        Joi.object({
        // ── Base config ─────────────────────────────────────────────
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        CORS_ORIGIN: Joi.string().optional(),
        DATABASE_URL: Joi.string().optional(),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        JWT_SECRET: Joi.string().optional(),
        AI_PROVIDER: Joi.string().valid('claude', 'openai', 'mock').default('mock'),
        ANTHROPIC_API_KEY: Joi.string().optional(),
        OPENAI_API_KEY: Joi.string().optional(),
        AI_MODEL: Joi.string().optional(),
        AI_MAX_TOKENS: Joi.number().default(4096),
        AI_TEMPERATURE: Joi.number().default(0.7),
        LOCALE: Joi.string().default('en'),

        // ── Cron schedules ──────────────────────────────────────────
        CRON_CLEANUP_SCHEDULE: Joi.string().default('0 0 * * *'),
        CRON_ANALYTICS_SCHEDULE: Joi.string().default('0 */6 * * *'),
        CRON_NOTIFICATIONS_SCHEDULE: Joi.string().default('*/30 * * * *'),
        CRON_CONTRACT_REPLAY_SCHEDULE: Joi.string().optional(),

        // ── #395: Feature flags for contract ingestion ───────────────
        CONTRACT_INGESTION_ENABLED: Joi.string()
          .valid('true', 'false')
          .default('false')
          .description('Must be explicitly "true" to enable contract ingestion.'),

        // ── #393: Contract registry schema validation ────────────────
        CONTRACT_REGISTRY_REQUIRE_SCHEMA: Joi.string()
          .valid('true', 'false')
          .default('true')
          .description('When "true", registry entries must pass schema compatibility checks.'),

        // ── #394: Event replay ────────────────────────────────────────
        CONTRACT_EVENT_REPLAY_ENABLED: Joi.string()
          .valid('true', 'false')
          .default('false')
          .description('When "true", contract event replay is available.'),

        // ── #396: Contract adapter config ────────────────────────────
        CONTRACT_ADAPTER_MODE: Joi.string()
          .valid('native', 'stellar', 'mock')
          .default('mock'),
        CONTRACT_NETWORK: Joi.string()
          .valid('testnet', 'futurenet', 'mainnet')
          .default('testnet'),
        STELLAR_HORIZON_URL: Joi.string().uri().optional(),

        // ── Contract registry limits ─────────────────────────────────
        CONTRACT_REGISTRY_MAX_ENTRIES: Joi.number().integer().min(1).default(1000),
        CONTRACT_SCHEMA_VERSION: Joi.string()
          .pattern(/^\d+\.\d+\.\d+$/)
          .default('1.0.0'),
        CONTRACT_REPLAY_MAX_EVENTS: Joi.number().integer().min(1).max(10000).default(1000),
        CONTRACT_EVENT_RETENTION_DAYS: Joi.number().integer().min(1).max(365).default(90),
        }),
      ),
      cache: true,
      envFilePath: ['.env.local', '.env'],
      expandVariables: true,
      validationOptions: {
        // Report every invalid variable at once and coerce string env
        // values to their declared types (numbers, booleans, lists, JSON).
        abortEarly: false,
        allowUnknown: true,
        convert: true,
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}