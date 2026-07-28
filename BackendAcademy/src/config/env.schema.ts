import * as Joi from 'joi';

/**
 * Base environment variable schema for core application configuration.
 */
export const baseEnvSchema = Joi.object({
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
});

/**
 * Environment variable schema that enforces explicit feature flags
 * for contract ingestion and processing. Contract processing modules
 * MUST NOT activate unless their corresponding feature flags are
 * explicitly set to 'true'.
 *
 * This schema extends the base config validation in config.module.ts
 * with contract-specific and feature-flag constraints.
 */
export const contractEnvSchema = Joi.object({
  // ── Certificate configuration (#357) ──────────────────────────────
  /** Base URL for certificate verification and sharing */
  CERTIFICATE_BASE_URL: Joi.string()
    .uri()
    .default('https://rustacademy.xyz/certificates')
    .description(
      'Base URL used to construct shareable certificate verification ' +
        'links. Each certificate gets a URL in the form ' +
        '{CERTIFICATE_BASE_URL}/verify/{code}.',
    ),

  // ── Feature flags for contract ingestion ──────────────────────────
  /** Explicitly enables the contract ingestion pipeline */
  CONTRACT_INGESTION_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description(
      'Must be explicitly "true" to enable contract ingestion. ' +
        'Any other value (or absence) disables ingestion.',
    ),

  /** Enables schema compatibility checks on contract registry */
  CONTRACT_REGISTRY_REQUIRE_SCHEMA: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description(
      'When "true", contract registry entries must pass schema ' +
        'compatibility validation before being accepted.',
    ),

  /** Enables contract event replay for recovery/auditing */
  CONTRACT_EVENT_REPLAY_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description(
      'When "true", contract event replay endpoints are available ' +
        'for state recovery and auditing.',
    ),

  // ── Contract adapter configuration ────────────────────────────────
  /** Contract adapter mode: 'native' | 'stellar' | 'mock' */
  CONTRACT_ADAPTER_MODE: Joi.string()
    .valid('native', 'stellar', 'mock')
    .default('mock')
    .description(
      'Determines which contract adapter implementation is used. ' +
        '"mock" is the default and safe for local development.',
    ),

  /** Stellar network for contract operations */
  CONTRACT_NETWORK: Joi.string()
    .valid('testnet', 'futurenet', 'mainnet')
    .default('testnet')
    .description('Stellar network target for contract deployments.'),

  /** Horizon server URL for Stellar contract operations */
  STELLAR_HORIZON_URL: Joi.string()
    .uri()
    .optional()
    .description('Stellar Horizon server URL for contract queries.'),

  // ── Contract registry configuration ───────────────────────────────
  /** Maximum number of contract registrations allowed */
  CONTRACT_REGISTRY_MAX_ENTRIES: Joi.number()
    .integer()
    .min(1)
    .default(1000)
    .description('Maximum number of contract registry entries.'),

  /** Required contract schema version for compatibility */
  CONTRACT_SCHEMA_VERSION: Joi.string()
    .pattern(/^\d+\.\d+\.\d+$/)
    .default('1.0.0')
    .description(
      'Minimum required contract schema version for registry ' +
        'compatibility. Format: MAJOR.MINOR.PATCH',
    ),

  // ── Event replay configuration ────────────────────────────────────
  /** Maximum events to replay in a single batch */
  CONTRACT_REPLAY_MAX_EVENTS: Joi.number()
    .integer()
    .min(1)
    .max(10000)
    .default(1000)
    .description('Maximum number of contract events to replay in a single batch.'),

  /** Retention period for contract events in days */
  CONTRACT_EVENT_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(365)
    .default(90)
    .description('Number of days to retain contract event logs for replay.'),
});

/**
 * Type derived from the contract env schema validation.
 */
export const jobEnvSchema = Joi.object({
  MAX_JOB_RETRIES: Joi.number().integer().min(0).max(10).default(3)
    .description('Maximum number of retries for background jobs before sending to DLQ'),

  JOB_RETRY_DELAY_MS: Joi.number().integer().min(100).default(5000)
    .description('Delay in milliseconds between job retries'),

  DLQ_TTL_SECONDS: Joi.number().integer().min(60).default(604800)
    .description('TTL in seconds for dead-letter queue records (default: 7 days)'),

  EXPORT_NOTIFICATION_ENABLED: Joi.boolean().default(true)
    .description('Enable email notifications when exports/reports are ready'),

  EXPORT_RETRY_MAX: Joi.number().integer().min(0).max(10).default(3)
    .description('Maximum retry attempts for export generation jobs'),

  SIGNED_URL_TTL_SECONDS: Joi.number().integer().min(60).max(86400).default(3600)
    .description('TTL in seconds for signed download URLs (default: 1 hour)'),
});

export type JobEnvConfig = {
  MAX_JOB_RETRIES: number;
  JOB_RETRY_DELAY_MS: number;
  DLQ_TTL_SECONDS: number;
  EXPORT_NOTIFICATION_ENABLED: boolean;
  EXPORT_RETRY_MAX: number;
  SIGNED_URL_TTL_SECONDS: number;
};

export type ContractEnvConfig = {
  CERTIFICATE_BASE_URL: string;
  CONTRACT_INGESTION_ENABLED: string;
  CONTRACT_REGISTRY_REQUIRE_SCHEMA: string;
  CONTRACT_EVENT_REPLAY_ENABLED: string;
  CONTRACT_ADAPTER_MODE: string;
  CONTRACT_NETWORK: string;
  STELLAR_HORIZON_URL?: string;
  CONTRACT_REGISTRY_MAX_ENTRIES: number;
  CONTRACT_SCHEMA_VERSION: string;
  CONTRACT_REPLAY_MAX_EVENTS: number;
  CONTRACT_EVENT_RETENTION_DAYS: number;
};

/**
 * Resolves whether a feature flag string is explicitly enabled.
 * Only the literal string "true" qualifies as enabled.
 */
export function isFeatureEnabled(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * Resolves whether a feature flag string is explicitly disabled.
 * Only the literal string "false" qualifies as explicitly disabled.
 * Any other value (or absence) is considered misconfigured.
 */
export function isFeatureExplicitlyDisabled(value: string | undefined): boolean {
  return value === 'false';
}

/**
 * Environment variables for notification delivery and preferences (#385).
 */
export const notificationEnvSchema = Joi.object({
 * Environment variables for notification delivery and preferences.
 */
export const notificationEnvSchema = Joi.object({
  /** When "true", user notification preferences are enforced before delivery */
  NOTIFICATION_ENFORCE_PREFERENCES: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description(
      'When "true", notification delivery checks user preferences first. ' +
        'Set to "false" to bypass preference checks for critical system alerts.',
    ),
  NOTIFICATION_DEFAULT_CHANNEL: Joi.string()
    .valid('email', 'push', 'in-app', 'all')
    .default('all')
    .description('Default notification channel for users without explicit preferences.'),
});

/**
 * Combined validation schema that includes contract and notification
 * environment variables. Used by config.module.ts at startup.
 */
export const validationSchema = baseEnvSchema
  .concat(contractEnvSchema)
 * Environment variables for migration safety and ordering.
 */
export const migrationEnvSchema = Joi.object({
  /** Timeout in milliseconds for acquiring a migration lock */
  MIGRATION_LOCK_TIMEOUT: Joi.number()
    .integer()
    .min(1000)
    .default(300_000)
    .description('Timeout in ms for acquiring a migration lock (default 5 min).'),

  /** Maximum number of retry attempts for failed migrations */
  MIGRATION_RETRY_ATTEMPTS: Joi.number()
    .integer()
    .min(0)
    .max(10)
    .default(3)
    .description('Maximum retry attempts for failed migrations.'),

  /** When true, strict ordering is enforced and migrations out of order are rejected */
  MIGRATION_STRICT_ORDERING: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description(
      'When "true", migrations must be applied strictly in dependency order. ' +
        'Any ordering violation blocks migration execution.',
    ),

  /** When true, a preflight check is required before any migration can run */
  MIGRATION_REQUIRE_PREFLIGHT: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description(
      'When "true", preflight validation must pass before migrations execute.',
    ),
});

/**
 * Combined validation schema that includes base, contract, migration,
 * and notification environment variables.
 * Used by config.module.ts to validate all env vars at startup.
 */
export const validationSchema = baseEnvSchema
  .concat(contractEnvSchema)
  .concat(migrationEnvSchema)
  .concat(notificationEnvSchema);
