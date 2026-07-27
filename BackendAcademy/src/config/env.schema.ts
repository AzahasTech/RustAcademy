import * as Joi from 'joi';

export const envSchema = Joi.object({
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
  CRON_CLEANUP_SCHEDULE: Joi.string().default('0 0 * * *'),
  CRON_ANALYTICS_SCHEDULE: Joi.string().default('0 */6 * * *'),
  CRON_NOTIFICATIONS_SCHEDULE: Joi.string().default('*/30 * * * *'),
  ANALYTICS_BATCH_SIZE: Joi.number().default(100),
  ANALYTICS_MAX_PAYLOAD_SIZE: Joi.number().default(1048576),
  ANALYTICS_RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
  ANALYTICS_RATE_LIMIT_MAX: Joi.number().default(100),
  ANALYTICS_RETENTION_DAYS: Joi.number().default(30),
});

export interface AnalyticsEnvConfig {
  ANALYTICS_BATCH_SIZE: number;
  ANALYTICS_MAX_PAYLOAD_SIZE: number;
  ANALYTICS_RATE_LIMIT_WINDOW_MS: number;
  ANALYTICS_RATE_LIMIT_MAX: number;
  ANALYTICS_RETENTION_DAYS: number;
}