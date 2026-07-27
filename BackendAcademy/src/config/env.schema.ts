import * as Joi from 'joi';

// ---------------------------------------------------------------------------
// Shared coercion helpers
//
// All list / boolean / JSON environment values MUST be declared here so they
// are parsed once, identically, regardless of where the process runs
// (local `.env`, Docker, CI, Kubernetes). Consumers should read values via
// `ConfigService`, which returns the coerced value from this schema.
// ---------------------------------------------------------------------------

/** Coerces a comma-separated string into a trimmed, non-empty string array. */
export const csvList = (): Joi.Schema =>
  Joi.custom((value: unknown, helpers) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') {
      return helpers.error('string.base');
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }, 'comma-separated list');

/** Strict boolean that accepts the usual env spellings only. */
export const booleanString = (): Joi.BooleanSchema =>
  Joi.boolean().truthy('1', 'yes', 'on').falsy('0', 'no', 'off');

/** Parses a JSON object/array from a string env value. */
export const jsonValue = (): Joi.Schema =>
  Joi.custom((value: unknown, helpers) => {
    if (typeof value === 'object' && value !== null) return value;
    if (typeof value !== 'string') {
      return helpers.error('string.base');
    }
    try {
      return JSON.parse(value);
    } catch {
      return helpers.error('any.invalid');
    }
  }, 'JSON value');

/**
 * `CORS_ORIGIN` supports either the wildcard `*` or a comma-separated list
 * of origins (e.g. `https://a.com,https://b.com`).
 */
const corsOrigin = Joi.alternatives().try(Joi.string().valid('*'), csvList());

export const validationSchema = Joi.object({
  // Server
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  // Database
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // Auth
  JWT_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  JWT_REFRESH_SECRET: Joi.string().optional(),
  /** Access token TTL in seconds. */
  JWT_ACCESS_EXPIRES_IN: Joi.number().integer().positive().default(900),
  /** Refresh token TTL in seconds. */
  JWT_REFRESH_EXPIRES_IN: Joi.number().integer().positive().default(604_800),

  // API Keys
  API_KEY_SECRET: Joi.string().optional(),

  // CORS
  CORS_ORIGIN: corsOrigin.default('*'),

  // Rate limiting
  THROTTLE_TTL_MS: Joi.number().integer().positive().default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(10),

  // AI Provider
  AI_PROVIDER: Joi.string().valid('claude', 'openai', 'mock').default('mock'),
  ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  AI_MODEL: Joi.string().allow('').optional(),
  AI_MAX_TOKENS: Joi.number().integer().positive().default(4096),
  AI_TEMPERATURE: Joi.number().min(0).max(2).default(0.7),

  // Static & uploaded assets
  ASSETS_UPLOAD_DIR: Joi.string().default('./data/uploads'),
  ASSETS_MAX_SIZE_MB: Joi.number().positive().default(10),
  ASSETS_BASE_URL: Joi.string().default('/api/v1/assets'),
  ASSETS_STATIC_DIR: Joi.string().default('./public'),
});
