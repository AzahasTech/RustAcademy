import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
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

  DEFAULT_REQUEST_TIMEOUT_MS: Joi.number().default(30000).description('Global outbound request timeout in ms'),
  WEBHOOK_MAX_RETRIES: Joi.number().default(5).description('Maximum webhook delivery retry attempts'),
  WEBHOOK_BASE_BACKOFF_MS: Joi.number().default(1000).description('Base backoff for webhook retries in ms'),
  WEBHOOK_MAX_BACKOFF_MS: Joi.number().default(60000).description('Maximum backoff for webhook retries in ms'),
  WEBHOOK_SIGNATURE_SECRET: Joi.string().optional().description('HMAC secret for verifying webhook signatures'),
  WEBHOOK_IDEMPOTENCY_TTL_SECONDS: Joi.number().default(3600).description('TTL for webhook idempotency keys'),
});
