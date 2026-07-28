import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .description('Runtime environment for the application'),

  PORT: Joi.number()
    .port()
    .default(3000)
    .description('Port number for the HTTP server'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql', 'mysql', 'sqlite', 'http', 'https'] })
    .optional()
    .description('Database connection URL'),

  REDIS_HOST: Joi.string()
    .default('localhost')
    .description('Redis host used for caching and background jobs'),

  REDIS_PORT: Joi.number()
    .integer()
    .min(1)
    .max(65535)
    .default(6379)
    .description('Redis port number'),

  JWT_SECRET: Joi.string()
    .min(10)
    .optional()
    .description('JWT signing secret for authentication tokens'),
})
  .unknown(false)
  .options({ abortEarly: false });
