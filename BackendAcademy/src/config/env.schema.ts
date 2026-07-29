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
    .max(365)
    .default(90)
    .description('Number of days to retain contract event logs for replay.'),

  // ── Attachment scanning configuration — Issue #365 ──────────────
  /** Maximum allowed attachment file size in bytes */
  MAX_ATTACHMENT_SIZE_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(10_485_760)
    .description('Maximum allowed attachment file size in bytes (default: 10 MB).'),

  /** Comma-separated list of allowed MIME types for attachments */
  ALLOWED_ATTACHMENT_TYPES: Joi.string()
    .optional()
    .description(
      'Comma-separated list of allowed MIME types for submission attachments. ' +
        'Example: "application/pdf,image/png,text/plain"',
    ),

  /** Whether attachment content policy scanning is enabled */
  ATTACHMENT_SCANNING_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description('When "true", submission attachments are scanned for policy violations.'),

  // ── Readiness probe configuration — Issue #376 ──────────────────
  /** Timeout for readiness probe checks in milliseconds */
  READINESS_PROBE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .default(5_000)
    .description('Timeout for readiness probe dependency checks in milliseconds.'),

  // ── Task orchestrator configuration — Issue #364 ────────────────
  /** Maximum retries for task orchestration */
  TASK_ORCHESTRATOR_MAX_RETRIES: Joi.number()
    .integer()
    .min(0)
    .default(3)
    .description('Maximum number of retry attempts for scheduled tasks.'),

  /** Base backoff time in milliseconds for task retries */
  TASK_ORCHESTRATOR_BASE_BACKOFF_MS: Joi.number()
    .integer()
    .min(100)
    .default(1_000)
    .description('Base backoff time in milliseconds before task retries.'),

  /** Maximum backoff time in milliseconds for task retries */
  TASK_ORCHESTRATOR_MAX_BACKOFF_MS: Joi.number()
    .integer()
    .min(100)
    .default(30_000)
    .description('Maximum backoff time in milliseconds for task retries.'),
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
  MAX_ATTACHMENT_SIZE_BYTES: number;
  ALLOWED_ATTACHMENT_TYPES?: string;
  ATTACHMENT_SCANNING_ENABLED: string;
  READINESS_PROBE_TIMEOUT_MS: number;
  TASK_ORCHESTRATOR_MAX_RETRIES: number;
  TASK_ORCHESTRATOR_BASE_BACKOFF_MS: number;
  TASK_ORCHESTRATOR_MAX_BACKOFF_MS: number;
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
