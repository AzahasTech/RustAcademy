import * as Joi from 'joi';

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
export type ContractEnvConfig = {
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
