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
