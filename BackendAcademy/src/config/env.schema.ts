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
  ERROR_LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('error'),
  ERROR_METRICS_ENABLED: Joi.boolean().default(true),
  ERROR_CODES_FILE_PATH: Joi.string().optional(),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
  RATE_LIMIT_MAX: Joi.number().default(100),
});

export interface ErrorConfig {
  ERROR_LOG_LEVEL: string;
  ERROR_METRICS_ENABLED: boolean;
  ERROR_CODES_FILE_PATH?: string;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
}