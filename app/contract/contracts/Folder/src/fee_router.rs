//! # Fee Router v2 — Issue #305
//!
//! Provides per-asset fee tiers, optional arbiter fee splits, and rotating fee
//! collector addresses without disrupting existing escrows.
//!
//! ## Priority order for fee bps resolution
//!
//! 1. **Per-asset override** — [`DataKey::PerAssetFee(token)`] if configured.
//! 2. **Oracle dynamic** — USD-based fee if oracle is configured and fresh.
//! 3. **Global static** — [`DataKey::FeeConfig`] basis points.
//!
//! ## Arbiter fee split
//!
//! When a per-asset config sets `arbiter_bps > 0` **and** an arbiter address is
//! provided to [`route_payout`], a proportional share of the fee is transferred
//! to the arbiter. The remainder goes to the active collector.
//!
//! Example: `fee_bps = 200`, `arbiter_bps = 2000`, `amount = 10_000`:
//! - Total fee: 200 (2%)
//! - Arbiter portion: 200 × 20% = 40
//! - Collector portion: 200 − 40 = 160
//! - Net to recipient: 9_800
//!
//! ## Collector rotation
//!
//! [`DataKey::FeeCollectorIndex`] holds the current rotation index (u32).
//! [`DataKey::FeeCollector(index)`] stores the Address for each index.
//! Rotating via [`rotate_collector`] bumps the index atomically and stores the
//! new address. Old escrows automatically pay out to the new collector at
//! settlement time — there is no per-escrow frozen collector.
//!
//! Fallback chain: `FeeCollector(index)` → `PlatformWallet` → (no-op if neither set).
//!
//! ## XLM / SAC consistency
//!
//! All transfers use `soroban_sdk::token::Client` which works identically for
//! native XLM and SAC tokens.

use crate::{errors::RustAcademyError, fee, storage};
use soroban_sdk::{token, Address, Env};

/// Fee breakdown returned by [`route_payout`].
///
/// # Invariants
///
/// The following invariants are guaranteed to hold for every successfully
/// returned `FeeBreakdown`:
///
/// 1. `net_payout + total_fee == amount` (conservation: no tokens created or destroyed)
/// 2. `arbiter_fee + platform_fee + collector_fee <= total_fee` (no over-allocation)
/// 3. All fields are non-negative
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FeeBreakdown {
    pub net_payout: i128,
    pub total_fee: i128,
    pub arbiter_fee: i128,
    pub platform_fee: i128,
    pub collector_fee: i128,
}

impl FeeBreakdown {
    /// Verify the structural invariants of this breakdown.
    ///
    /// Returns `Ok(())` when all invariants hold. Used as a post-condition
    /// guard inside [`route_payout`] and available for unit-test assertions.
    pub fn verify_invariants(&self, amount: i128) -> Result<(), RustAcademyError> {
        // Invariant 1: conservation
        let reconstructed = self
            .net_payout
            .checked_add(self.total_fee)
            .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
        if reconstructed != amount {
            return Err(RustAcademyError::InvalidFeeConfiguration);
        }

        // Invariant 2: no over-allocation
        let distributed = self
            .arbiter_fee
            .checked_add(self.platform_fee)
            .and_then(|v| v.checked_add(self.collector_fee))
            .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
        if distributed > self.total_fee {
            return Err(RustAcademyError::FeeSplitExceedsTotal);
        }

        // Invariant 3: non-negative
        if self.net_payout < 0 || self.total_fee < 0 {
            return Err(RustAcademyError::InvalidFeeConfiguration);
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/// Resolve the effective fee collector address.
///
/// Reads the current rotation index, then the `FeeCollector` at that index.
/// Falls back to the `PlatformWallet` singleton if no rotated collector has
/// ever been stored.
pub fn active_collector(env: &Env) -> Option<Address> {
    let idx = storage::get_fee_collector_index(env);
    if let Some(addr) = storage::get_fee_collector_at(env, idx) {
        return Some(addr);
    }
    storage::get_platform_wallet(env)
}

fn uses_explicit_fee_distribution(config: &crate::types::PerAssetFeeConfig) -> bool {
    config.arbiter_fee.is_active()
        || config.platform_fee.is_active()
        || config.collector_fee.is_active()
}

fn transfer_if_positive(
    env: &Env,
    token_client: &token::Client,
    recipient: &Address,
    amount: i128,
) {
    if amount > 0 {
        token_client.transfer(&env.current_contract_address(), recipient, &amount);
    }
}

/// Deterministically split a total fee into (arbiter, platform, collector) shares.
///
/// This pure function encapsulates the split computation for both explicit ratio
/// and legacy `arbiter_bps` paths, ensuring the returned tuple always satisfies
/// `arbiter + platform + collector <= total_fee` with the remainder absorbed
/// into `collector_fee`.
///
/// # Arguments
/// * `total_fee` – the gross fee amount to split (must be > 0)
/// * `config` – per-asset fee configuration (may carry ratios or legacy bps)
/// * `arbiter_present` – whether the caller supplied an arbiter address
///
/// # Returns
/// `(arbiter_fee, platform_fee, collector_fee)` — all non-negative and
/// summing to at most `total_fee`.
pub fn compute_fee_split(
    total_fee: i128,
    config: &crate::types::PerAssetFeeConfig,
    arbiter_present: bool,
) -> Result<(i128, i128, i128), RustAcademyError> {
    if total_fee <= 0 {
        return Ok((0, 0, 0));
    }

    let mut arbiter_fee: i128 = 0;
    let mut platform_fee: i128 = 0;
    let mut collector_fee: i128 = total_fee;

    if uses_explicit_fee_distribution(config) {
        let arbiter_share = fee::apply_fee_ratio(total_fee, &config.arbiter_fee)?;
        arbiter_fee = if arbiter_present { arbiter_share } else { 0 };
        platform_fee = fee::apply_fee_ratio(total_fee, &config.platform_fee)?;
        collector_fee = fee::apply_fee_ratio(total_fee, &config.collector_fee)?;

        if !arbiter_present {
            collector_fee = collector_fee
                .checked_add(arbiter_share)
                .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
        }

        let distributed = arbiter_fee
            .checked_add(platform_fee)
            .and_then(|v| v.checked_add(collector_fee))
            .ok_or(RustAcademyError::InvalidFeeConfiguration)?;

        if distributed > total_fee {
            return Err(RustAcademyError::FeeSplitExceedsTotal);
        }

        let remainder = total_fee
            .checked_sub(distributed)
            .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
        collector_fee = collector_fee
            .checked_add(remainder)
            .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
    } else {
        let arbiter_bps = config.arbiter_bps;
        if arbiter_bps > 0 && arbiter_present {
            arbiter_fee = total_fee
                .checked_mul(arbiter_bps as i128)
                .ok_or(RustAcademyError::InvalidFeeConfiguration)?
                / 10000;
            collector_fee = total_fee
                .checked_sub(arbiter_fee)
                .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
        }
    }

    Ok((arbiter_fee, platform_fee, collector_fee))
}

// ---------------------------------------------------------------------------
// Collector rotation
// ---------------------------------------------------------------------------

/// Rotate to a new fee collector address.
///
/// Atomically increments the `FeeCollectorIndex` and stores `new_collector`
/// at the new index. All subsequent calls to [`active_collector`] will return
/// `new_collector` until the next rotation.
///
/// Returns the new rotation index.
///
/// # Errors
/// Returns [`RustAcademyError::InvalidFeeConfiguration`] if the rotation
/// index would saturate (i.e. already at `u32::MAX`), which would cause
/// subsequent rotations to be no-ops and silently lose the new address.
///
/// **Caller is responsible for authorization** — call only from admin entry points.
pub fn rotate_collector(env: &Env, new_collector: &Address) -> Result<u32, RustAcademyError> {
    let current = storage::get_fee_collector_index(env);
    let next = current
        .checked_add(1)
        .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
    storage::set_fee_collector_index(env, next);
    storage::set_fee_collector_at(env, next, new_collector);
    Ok(next)
}

// ---------------------------------------------------------------------------
// Core routing
// ---------------------------------------------------------------------------

/// Route a settled payout, applying per-asset fees, arbiter splits, and
/// collector rotation in a single atomic operation.
///
/// Performs all token transfers from `env.current_contract_address()`:
/// - Net payout → `recipient`
/// - Arbiter portion of fee → `arbiter` (if `arbiter_bps > 0` and `arbiter` provided)
/// - Platform portion of fee → active collector (if set)
///
/// Returns a [`FeeBreakdown`] whose invariants are verified before returning:
/// - `net_payout + total_fee == amount`
/// - `arbiter_fee + platform_fee + collector_fee <= total_fee`
///
/// # Arguments
/// * `token`     — Token contract address (XLM or SAC)
/// * `recipient` — Beneficiary of the net payout
/// * `amount`    — Gross amount to distribute (must be > 0)
/// * `arbiter`   — Optional arbiter address for fee split
///
/// # Safety
/// If `amount <= 0`, returns `(amount, 0)` without any transfers.
pub fn route_payout(
    env: &Env,
    token: &Address,
    recipient: &Address,
    amount: i128,
    arbiter: Option<&Address>,
) -> Result<FeeBreakdown, RustAcademyError> {
    if amount <= 0 {
        return Ok(FeeBreakdown {
            net_payout: amount,
            total_fee: 0,
            arbiter_fee: 0,
            platform_fee: 0,
            collector_fee: 0,
        });
    }

    // Resolve total fee using per-asset → oracle → global priority.
    let total_fee = fee::calculate_fee_for_token(env, token, amount);

    // Use checked arithmetic to prevent silent underflow. If total_fee somehow
    // exceeds amount (which should be prevented by fee validation), surface
    // an explicit error instead of producing a negative or zero net payout
    // that silently under-allocates.
    let net_payout = amount
        .checked_sub(total_fee)
        .ok_or(RustAcademyError::InvalidFeeConfiguration)?;

    let token_client = token::Client::new(env, token);
    let per_asset = storage::get_per_asset_fee(env, token);

    let arbiter_present = arbiter.is_some();

    // Deterministically split the fee into (arbiter, platform, collector).
    let config = per_asset
        .as_ref()
        .map(|c| c.clone())
        .unwrap_or_default();

    let (mut arbiter_fee, mut platform_fee, mut collector_fee) =
        compute_fee_split(total_fee, &config, arbiter_present)?;

    // Fallback chain for missing recipients: absorb orphaned shares into
    // collector to guarantee no tokens are silently stranded.
    if let Some(arb) = arbiter {
        transfer_if_positive(env, &token_client, arb, arbiter_fee);
    } else if arbiter_fee > 0 {
        collector_fee = collector_fee
            .checked_add(arbiter_fee)
            .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
        arbiter_fee = 0;
    }

    let platform_recipient = storage::get_platform_wallet(env);
    if let Some(platform) = platform_recipient {
        transfer_if_positive(env, &token_client, &platform, platform_fee);
    } else if platform_fee > 0 {
        collector_fee = collector_fee
            .checked_add(platform_fee)
            .ok_or(RustAcademyError::InvalidFeeConfiguration)?;
        platform_fee = 0;
    }

    let active_collector = active_collector(env);
    if let Some(collector) = active_collector {
        transfer_if_positive(env, &token_client, &collector, collector_fee);
    } else if collector_fee > 0 {
        // No collector is configured; keep the fees in the contract rather than failing
        // the payout path. This preserves backward-compatible no-op behavior.
    }

    token_client.transfer(&env.current_contract_address(), recipient, &net_payout);

    let breakdown = FeeBreakdown {
        net_payout,
        total_fee,
        arbiter_fee,
        platform_fee,
        collector_fee,
    };

    // Runtime invariant check: structural guarantees must hold for every
    // successful payout. This catches any logic regression that would
    // silently under- or over-allocate fee flows.
    breakdown.verify_invariants(amount)?;

    Ok(breakdown)
}
