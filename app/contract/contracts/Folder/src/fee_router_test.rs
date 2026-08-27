use crate::{
    types::{FeeRatio, PerAssetFeeConfig},
    EscrowStatus,  RustAcademyContract,  RustAcademyContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, Env,
};

fn setup<'a>() -> (Env,  RustAcademyContractClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);

    let contract_id = env.register( RustAcademyContract, ());
    let client =  RustAcademyContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    (env, client, admin)
}

fn create_token(env: &Env) -> Address {
    env.register_stellar_asset_contract_v2(Address::generate(env))
        .address()
}

#[test]
fn test_fee_router_per_asset_overrides_global_across_assets() {
    let (env, client, admin) = setup();

    // "XLM" and "SAC" are both represented as token contract addresses in Soroban.
    let xlm_token = create_token(&env);
    let sac_token = create_token(&env);

    let user = Address::generate(&env);
    let collector = Address::generate(&env);

    let xlm_admin = token::StellarAssetClient::new(&env, &xlm_token);
    let sac_admin = token::StellarAssetClient::new(&env, &sac_token);
    let xlm_client = token::Client::new(&env, &xlm_token);
    let sac_client = token::Client::new(&env, &sac_token);

    xlm_admin.mint(&user, &10_000);
    sac_admin.mint(&user, &10_000);

    // Global fee = 5%.
    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 500,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_platform_wallet(&admin, &collector);

    // Per-asset override for XLM token = 10%.
    client.set_per_asset_fee(
        &admin,
        &xlm_token,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            ..Default::default()
        },
    );

    // Withdraw XLM path: fee should use per-asset 10%.
    let xlm_amount: i128 = 1_000;
    let xlm_salt = Bytes::from_slice(&env, b"fee_router_xlm_salt");
    let xlm_commitment = client.deposit(&xlm_token, &xlm_amount, &user, &xlm_salt, &0, &None);
    client.withdraw(&xlm_token, &xlm_amount, &xlm_commitment, &user, &xlm_salt);

    // Withdraw SAC path: fee should use global 5%.
    let sac_amount: i128 = 1_000;
    let sac_salt = Bytes::from_slice(&env, b"fee_router_sac_salt");
    let sac_commitment = client.deposit(&sac_token, &sac_amount, &user, &sac_salt, &0, &None);
    client.withdraw(&sac_token, &sac_amount, &sac_commitment, &user, &sac_salt);

    // Expected fees: XLM 100 + SAC 50 = 150 to collector.
    assert_eq!(xlm_client.balance(&collector), 100);
    assert_eq!(sac_client.balance(&collector), 50);

    // User received net payout per token and no escrow balance remains in contract.
    assert_eq!(xlm_client.balance(&client.address), 0);
    assert_eq!(sac_client.balance(&client.address), 0);

    // Sanity check statuses are terminal and correct.
    assert_eq!(
        client.get_commitment_state(&xlm_commitment),
        Some(EscrowStatus::Spent)
    );
    assert_eq!(
        client.get_commitment_state(&sac_commitment),
        Some(EscrowStatus::Spent)
    );
}

#[test]
fn test_fee_router_dispute_with_optional_arbiter_split() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,     // 10% total fee
            arbiter_bps: 0,     // Explicit ratios take precedence; dual-mode is rejected.
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 5,
            },
            platform_fee: FeeRatio {
                numerator: 3,
                denominator: 10,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_dispute_split");
    let commitment = client.deposit(
        &token_id,
        &amount,
        &owner,
        &salt,
        &1000,
        &Some(arbiter.clone()),
    );

    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &recipient);

    // Fee math:
    // total_fee = 100
    // arbiter_fee = 20
    // platform_fee = 30
    // collector_fee = 50
    // recipient_net = 900
    assert_eq!(token_client.balance(&recipient), 900);
    assert_eq!(token_client.balance(&arbiter), 20);
    assert_eq!(token_client.balance(&platform_wallet), 30);
    assert_eq!(token_client.balance(&collector), 50);

    // Bound safety: payout + all fee recipients equals gross amount.
    assert_eq!(
        token_client.balance(&recipient)
            + token_client.balance(&arbiter)
            + token_client.balance(&platform_wallet)
            + token_client.balance(&collector),
        amount
    );
    assert_eq!(
        client.get_commitment_state(&commitment),
        Some(EscrowStatus::Spent)
    );
}

#[test]
fn test_fee_router_collector_rotation_applies_to_new_payouts_and_old_escrows() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let collector_v1 = Address::generate(&env);
    let collector_v2 = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    token_admin.mint(&owner, &20_000);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_platform_wallet(&admin, &collector_v1);

    // Escrow created before rotation.
    let amount_old: i128 = 1_000;
    let salt_old = Bytes::from_slice(&env, b"fee_router_old_escrow");
    let old_commitment = client.deposit(&token_id, &amount_old, &owner, &salt_old, &0, &None);

    // Rotate collector safely.
    let next_idx = client.rotate_fee_collector(&admin, &collector_v2);
    assert!(next_idx > 0);
    assert_eq!(
        client.get_active_fee_collector(),
        Some(collector_v2.clone())
    );

    // Settling old escrow after rotation should route fee to collector_v2.
    client.withdraw(&token_id, &amount_old, &old_commitment, &owner, &salt_old);

    // New escrow after rotation should also route to collector_v2.
    let amount_new: i128 = 1_000;
    let salt_new = Bytes::from_slice(&env, b"fee_router_new_escrow");
    let new_commitment = client.deposit(&token_id, &amount_new, &owner, &salt_new, &0, &None);
    client.withdraw(&token_id, &amount_new, &new_commitment, &owner, &salt_new);

    // 10% fee on each withdrawal => 100 + 100.
    assert_eq!(token_client.balance(&collector_v1), 0);
    assert_eq!(token_client.balance(&collector_v2), 200);

    // Old and new escrows both settled successfully.
    assert_eq!(
        client.get_commitment_state(&old_commitment),
        Some(EscrowStatus::Spent)
    );
    assert_eq!(
        client.get_commitment_state(&new_commitment),
        Some(EscrowStatus::Spent)
    );
}

#[test]
fn test_fee_router_rejects_overallocated_explicit_split() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // Ratios: platform=2/3, collector=2/3 => sum=4/3 > 1.0
    // Now rejected at configuration time by PerAssetFeeConfig::validate().
    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            platform_fee: FeeRatio {
                numerator: 2,
                denominator: 3,
            },
            collector_fee: FeeRatio {
                numerator: 2,
                denominator: 3,
            },
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}

// ---------------------------------------------------------------------------
// Edge-case tests (Issue #537)
// ---------------------------------------------------------------------------

#[test]
fn test_fee_router_zero_amount_rejected_by_deposit() {
    let (env, client, _admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    // Deposit of zero should be rejected (InvalidAmount).
    let amount: i128 = 0;
    let salt = Bytes::from_slice(&env, b"fee_router_zero_amount");
    let result = client.try_deposit(&token_id, &amount, &owner, &salt, &0, &None);
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}

#[test]
fn test_fee_router_negative_amount_produces_zero_fee() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let platform_wallet = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_platform_wallet(&admin, &platform_wallet);

    // A negative amount should be rejected by deposit validation.
    let result = client.try_deposit(
        &token_id,
        &(-1_i128),
        &owner,
        &Bytes::from_slice(&env, b"neg_amount"),
        &0,
        &None,
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}

#[test]
fn test_fee_router_exact_one_to_one_ratio_split() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // Ratios: arbiter=1/2, platform=1/4, collector=1/4 => sum = 1.0 exactly
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_exact_split");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &1000, &Some(arbiter.clone()));
    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &owner);

    // fee = 100, arbiter=50, platform=25, collector=25
    // Net = 900 (sent to owner via resolve_dispute)
    // Owner started with 10000, deposited 1000, so has 9000.
    // After dispute resolution pays 900 to owner: 9000 + 900 = 9900.
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(token_client.balance(&arbiter), 50);
    assert_eq!(token_client.balance(&platform_wallet), 25);
    assert_eq!(token_client.balance(&collector), 25);
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&arbiter)
            + token_client.balance(&platform_wallet)
            + token_client.balance(&collector),
        10_000
    );
}

#[test]
fn test_fee_router_ratio_sum_exceeds_one_is_rejected_at_config() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // Ratios: arbiter=1/2, platform=1/2, collector=1/4 => sum = 1.25 > 1.0
    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}

#[test]
fn test_fee_router_collector_rotation_overflow_rejected() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let collector = Address::generate(&env);

    // Push index to u32::MAX by setting it directly in storage.
    // Must use as_contract() since persistent storage is not
    // accessible from test context directly.
    env.as_contract(&client.address, || {
        env.storage().persistent().set(
            &crate::storage::DataKey::FeeCollectorIndex,
            &u32::MAX,
        );
    });

    let result = client.try_rotate_fee_collector(&admin, &collector);
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}

#[test]
fn test_fee_router_no_collector_no_platform_fees_retained() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    // Set fee but no platform wallet and no rotated collector.
    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000, // 10%
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    // Do NOT set platform wallet or rotate collector.

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_no_recipient");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    // Fee stays in the contract since no collector or platform wallet is configured.
    // Owner: 10000 - 1000 (deposit) + 900 (net withdrawal) = 9900
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(token_client.balance(&client.address), 100);
}

#[test]
fn test_fee_router_small_amount_integer_truncation() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let platform_wallet = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    // 1% fee
    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 100,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_platform_wallet(&admin, &platform_wallet);

    // Amount of 3 -> fee = 3 * 100 / 10000 = 0 (truncated to zero)
    let amount: i128 = 3;
    let salt = Bytes::from_slice(&env, b"fee_router_small_amount");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    // Fee truncates to 0, user gets full amount back.
    assert_eq!(token_client.balance(&owner), 10_000);
    assert_eq!(token_client.balance(&platform_wallet), 0);
}

#[test]
fn test_fee_router_set_fee_bps_over_max_rejected() {
    let (env, client, admin) = setup();

    // 10001 bps = 100.01% — should be rejected.
    let result = client.try_set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 10_001,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
    // Original config (0 bps) should still be in effect.
    assert_eq!(client.get_fee_config().fee_bps, 0);
}

#[test]
fn test_fee_router_all_zero_ratios_fallback_to_full_collector() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.rotate_fee_collector(&admin, &collector);

    // Set all ratios to 0 — explicit distribution path activates
    // (is_active checks numerator > 0, so all-zero means inactive).
    // Falls through to default collector_fee = total_fee.
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            platform_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            collector_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_zero_ratios");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    // Since none of the ratios are active, the explicit path is NOT entered
    // (uses_explicit_fee_distribution returns false). Falls to legacy bps=0
    // split, so full fee goes to collector.
    // Owner: 10000 - 1000 (deposit) + 900 (net withdrawal) = 9900
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(token_client.balance(&collector), 100);
}

#[test]
fn test_fee_router_platform_fee_only_split() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // Platform gets 1/2 of fee, collector gets 1/2.
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_platform_only");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    // fee=100, platform=50, collector=50, net=900
    // Owner: 10000 - 1000 (deposit) + 900 (net withdrawal) = 9900
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(token_client.balance(&platform_wallet), 50);
    assert_eq!(token_client.balance(&collector), 50);
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&platform_wallet)
            + token_client.balance(&collector),
        10_000
    );
}

#[test]
fn test_fee_router_multi_rotation_routes_to_latest() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let c1 = Address::generate(&env);
    let c2 = Address::generate(&env);
    let c3 = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &30_000);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );

    // Rotate three times.
    let idx1 = client.rotate_fee_collector(&admin, &c1);
    let idx2 = client.rotate_fee_collector(&admin, &c2);
    let idx3 = client.rotate_fee_collector(&admin, &c3);

    assert!(idx3 > idx2);
    assert!(idx2 > idx1);
    assert_eq!(
        client.get_active_fee_collector(),
        Some(c3.clone())
    );

    // All three withdrawals route to c3.
    for i in 0..3 {
        let amount: i128 = 1_000;
        let salt = Bytes::from_slice(&env, &[i; 1]);
        let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
        client.withdraw(&token_id, &amount, &commitment, &owner, &salt);
    }

    // 3 * 100 = 300 all goes to c3.
    assert_eq!(token_client.balance(&c1), 0);
    assert_eq!(token_client.balance(&c2), 0);
    assert_eq!(token_client.balance(&c3), 300);
}

#[test]
fn test_fee_router_per_asset_zero_bps_disables_fee() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let platform_wallet = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    // Global fee is 10%, but per-asset override sets fee_bps = 0.
    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_platform_wallet(&admin, &platform_wallet);

    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 0,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_zero_bps_override");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    // No fee — per-asset zero bps overrides global.
    assert_eq!(token_client.balance(&owner), 10_000);
    assert_eq!(token_client.balance(&platform_wallet), 0);
}

#[test]
fn test_fee_router_ratio_sum_validation_rejects_over_one() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // Three ratios each at 1/2 => sum = 1.5 > 1.0
    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}

#[test]
fn test_fee_router_large_amount_no_overflow() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let collector = Address::generate(&env);
    let platform_wallet = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    let large_balance: i128 = i128::MAX / 10;
    token_admin.mint(&owner, &large_balance); // Large but not max

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    let amount: i128 = 1_000_000_000; // 1B units
    let salt = Bytes::from_slice(&env, b"fee_router_large_amount");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    // 10% fee = 100M, net = 900M
    assert_eq!(token_client.balance(&collector), 100_000_000);
    assert_eq!(token_client.balance(&platform_wallet), 0); // no platform wallet fee split
    assert_eq!(token_client.balance(&client.address), 0);
}

#[test]
fn test_fee_router_explicit_ratio_without_arbiter_absorbs_arbiter_share() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // Explicit ratios: arbiter=1/2, platform=1/4, collector=1/4.
    // But NO arbiter address provided in the deposit.
    // Arbiter share (50) should be absorbed by collector.
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_no_arbiter_absorb");
    // No arbiter address provided.
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    // fee=100, arbiter_share=50 (absorbed by collector), platform=25, collector=25+50=75
    // Owner: 10000 - 1000 (deposit) + 900 (net withdrawal) = 9900
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(token_client.balance(&platform_wallet), 25);
    assert_eq!(token_client.balance(&collector), 75);
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&platform_wallet)
            + token_client.balance(&collector),
        10_000
    );
}

#[test]
fn test_fee_router_explicit_ratio_with_platform_absent_absorbs_platform_share() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let collector = Address::generate(&env);
    // No platform wallet set.

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.rotate_fee_collector(&admin, &collector);

    // Explicit ratios: arbiter=1/4, platform=1/4, collector=1/2.
    // No platform wallet configured — platform share should be absorbed by collector.
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_no_platform_absorb");
    // Use a zero-address arbiter that will receive the arbiter fee.
    let arbiter = Address::generate(&env);
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &1000, &Some(arbiter.clone()));
    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &owner);

    // fee=100, arbiter=25, platform_share=25 (absorbed by collector), collector=50+25=75
    // Owner: 10000 - 1000 (deposit) + 900 (net via resolve_dispute) = 9900
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(token_client.balance(&arbiter), 25);
    assert_eq!(token_client.balance(&collector), 75);
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&arbiter)
            + token_client.balance(&collector),
        10_000
    );
}

#[test]
fn test_fee_router_legacy_arbiter_bps_large_fee() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // 50% fee, arbiter_bps=5000 (50% of fee → 25% of gross)
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 5_000,
            arbiter_bps: 5_000,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            ..Default::default()
        },
    );

    let amount: i128 = 10_000;
    let salt = Bytes::from_slice(&env, b"fee_router_legacy_bps_large");
    let commitment = client.deposit(
        &token_id,
        &amount,
        &owner,
        &salt,
        &1000,
        &Some(arbiter.clone()),
    );
    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &owner);

    // fee = 5000 (50%)
    // arbiter_fee = 5000 * 5000 / 10000 = 2500
    // collector_fee = 5000 - 2500 = 2500
    // net = 5000
    assert_eq!(token_client.balance(&owner), 5_000); // was 0 before dispute resolution
    assert_eq!(token_client.balance(&arbiter), 2_500);
    assert_eq!(token_client.balance(&collector), 2_500);
    assert_eq!(token_client.balance(&platform_wallet), 0); // no platform in legacy path
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&arbiter)
            + token_client.balance(&collector)
            + token_client.balance(&platform_wallet),
        amount
    );
}

#[test]
fn test_fee_router_collector_rotation_index_monotonic() {
    let (env, client, admin) = setup();

    let mut prev_idx = 0u32;
    for _ in 0..10 {
        let new_collector = Address::generate(&env);
        let idx = client.rotate_fee_collector(&admin, &new_collector);
        assert!(idx > prev_idx, "index must be monotonically increasing");
        prev_idx = idx;
    }

    // After 10 rotations, index should be 10.
    assert_eq!(prev_idx, 10);
}

#[test]
fn test_fee_router_explicit_ratios_sum_exactly_one_passes() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // arbiter=1/3, platform=1/3, collector=1/3 => sum=1.0
    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 3,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 3,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 3,
            },
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Ok(()))));
}

#[test]
fn test_fee_router_all_ratios_zero_is_valid() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // All ratios zero — should pass validation (no active ratios to sum-check).
    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            platform_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            collector_fee: FeeRatio {
                numerator: 0,
                denominator: 1,
            },
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Ok(()))));
}

#[test]
fn test_fee_router_fee_bps_over_max_rejected_at_type_level() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // fee_bps > 10000 — should be rejected by PerAssetFeeConfig::validate().
    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 10_001,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));

    // arbiter_bps > 10000 — should also be rejected.
    let result2 = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 10_001,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            ..Default::default()
        },
    );
    assert!(matches!(result2, Ok(Err(_)) | Err(_)));
}

#[test]
fn test_fee_router_per_asset_zero_denominator_rejected() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    // denominator=0 is invalid — should be rejected.
    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 0,
            },
            platform_fee: FeeRatio::default(),
            collector_fee: FeeRatio::default(),
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}
// ---------------------------------------------------------------------------
// Hardened edge-case tests (Issue #537 -- enhanced)
// ---------------------------------------------------------------------------

#[test]
fn test_fee_router_breakdown_invariants_hold_for_explicit_split() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 3,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 3,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 3,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"invariant_explicit_split");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &1000, &Some(arbiter.clone()));
    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &owner);

    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&arbiter)
            + token_client.balance(&platform_wallet)
            + token_client.balance(&collector),
        10_000,
        "conservation invariant: all tokens accounted for"
    );
}

#[test]
fn test_fee_router_breakdown_invariants_hold_for_legacy_bps() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 3_333,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"invariant_legacy_bps");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &1000, &Some(arbiter.clone()));
    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &owner);

    assert_eq!(token_client.balance(&arbiter), 33);
    assert_eq!(token_client.balance(&collector), 67);
    assert_eq!(token_client.balance(&platform_wallet), 0);
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&arbiter)
            + token_client.balance(&collector)
            + token_client.balance(&platform_wallet),
        10_000
    );
}

#[test]
fn test_fee_router_rotation_to_same_address_twice() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );

    let idx1 = client.rotate_fee_collector(&admin, &collector);
    let idx2 = client.rotate_fee_collector(&admin, &collector);
    assert!(idx2 > idx1);
    assert_eq!(
        client.get_active_fee_collector(),
        Some(collector.clone())
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"same_addr_rotation");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    assert_eq!(token_client.balance(&collector), 100);
}

#[test]
fn test_fee_router_100_percent_fee_leaves_zero_net() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 10_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.rotate_fee_collector(&admin, &collector);

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fee_router_100pct");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    assert_eq!(token_client.balance(&collector), 1_000);
    assert_eq!(token_client.balance(&owner), 9_000);
}

#[test]
fn test_fee_router_dual_mode_rejected_at_config() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    let result = client.try_set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 1_000,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            ..Default::default()
        },
    );
    assert!(matches!(result, Ok(Err(_)) | Err(_)));
}

#[test]
fn test_fee_router_single_arbiter_ratio_only() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.rotate_fee_collector(&admin, &collector);

    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            platform_fee: FeeRatio::default(),
            collector_fee: FeeRatio::default(),
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"single_arbiter_ratio");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &1000, &Some(arbiter.clone()));
    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &owner);

    assert_eq!(token_client.balance(&arbiter), 50);
    assert_eq!(token_client.balance(&collector), 50);
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&arbiter)
            + token_client.balance(&collector),
        10_000
    );
}

#[test]
fn test_fee_router_no_arbiter_legacy_bps_all_to_collector() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 1_000,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 5_000,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            ..Default::default()
        },
    );
    client.rotate_fee_collector(&admin, &collector);

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"no_arbiter_legacy_bps");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &0, &None);
    client.withdraw(&token_id, &amount, &commitment, &owner, &salt);

    assert_eq!(token_client.balance(&collector), 100);
    assert_eq!(token_client.balance(&owner), 9_900);
}

#[test]
fn test_fee_router_fractional_ratios_below_one_remainder_to_collector() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &10_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            ..Default::default()
        },
    );

    let amount: i128 = 1_000;
    let salt = Bytes::from_slice(&env, b"fractional_remainder");
    let commitment = client.deposit(&token_id, &amount, &owner, &salt, &1000, &Some(arbiter.clone()));
    client.dispute(&commitment);
    client.resolve_dispute(&arbiter, &commitment, &false, &owner);

    assert_eq!(token_client.balance(&arbiter), 25);
    assert_eq!(token_client.balance(&platform_wallet), 25);
    assert_eq!(token_client.balance(&collector), 50);
    assert_eq!(token_client.balance(&owner), 9_900);
    assert_eq!(
        token_client.balance(&owner)
            + token_client.balance(&arbiter)
            + token_client.balance(&platform_wallet)
            + token_client.balance(&collector),
        10_000
    );
}

#[test]
fn test_fee_router_ratio_numerator_nonzero_denominator_zero_inactive() {
    let ratio = FeeRatio {
        numerator: 1,
        denominator: 0,
    };
    assert!(!ratio.is_active(), "ratio with zero denominator must be inactive");
}

#[test]
fn test_fee_router_compute_fee_split_legacy_bps() {
    use crate::fee_router::compute_fee_split;

    let config = PerAssetFeeConfig {
        fee_bps: 1_000,
        arbiter_bps: 2_500,
        schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
        ..Default::default()
    };

    let (arb, plat, coll) = compute_fee_split(200, &config, true).unwrap();
    assert_eq!(arb, 50);
    assert_eq!(plat, 0);
    assert_eq!(coll, 150);
    assert!(arb + plat + coll <= 200);

    let (arb2, plat2, coll2) = compute_fee_split(200, &config, false).unwrap();
    assert_eq!(arb2, 0);
    assert_eq!(plat2, 0);
    assert_eq!(coll2, 200);
}

#[test]
fn test_fee_router_compute_fee_split_explicit_ratios() {
    use crate::fee_router::compute_fee_split;

    let config = PerAssetFeeConfig {
        fee_bps: 1_000,
        arbiter_bps: 0,
        schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
        arbiter_fee: FeeRatio {
            numerator: 1,
            denominator: 5,
        },
        platform_fee: FeeRatio {
            numerator: 1,
            denominator: 10,
        },
        collector_fee: FeeRatio {
            numerator: 1,
            denominator: 2,
        },
    };

    let (arb, plat, coll) = compute_fee_split(100, &config, true).unwrap();
    assert_eq!(arb, 20);
    assert_eq!(plat, 10);
    assert_eq!(coll, 70);
    assert_eq!(arb + plat + coll, 100);
}

#[test]
fn test_fee_router_breakdown_invariants_multi_path() {
    let (env, client, admin) = setup();

    let token_id = create_token(&env);
    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let platform_wallet = Address::generate(&env);
    let collector = Address::generate(&env);

    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    token_admin.mint(&owner, &50_000);

    client.set_platform_wallet(&admin, &platform_wallet);
    client.rotate_fee_collector(&admin, &collector);

    client.set_per_asset_fee(
        &admin,
        &token_id,
        &PerAssetFeeConfig {
            fee_bps: 1_000,
            arbiter_bps: 0,
            schema_version: crate::types::PER_ASSET_FEE_SCHEMA_VERSION,
            arbiter_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            platform_fee: FeeRatio {
                numerator: 1,
                denominator: 4,
            },
            collector_fee: FeeRatio {
                numerator: 1,
                denominator: 2,
            },
            ..Default::default()
        },
    );

    let amount1: i128 = 1_000;
    let salt1 = Bytes::from_slice(&env, b"invariant_path_1");
    let c1 = client.deposit(&token_id, &amount1, &owner, &salt1, &1000, &Some(arbiter.clone()));
    client.dispute(&c1);
    client.resolve_dispute(&arbiter, &c1, &false, &owner);

    assert_eq!(token_client.balance(&arbiter), 25);
    assert_eq!(token_client.balance(&platform_wallet), 25);
    assert_eq!(token_client.balance(&collector), 50);

    client.set_fee_config(
        &admin,
        &crate::types::FeeConfig {
            fee_bps: 500,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );

    let amount2: i128 = 2_000;
    let salt2 = Bytes::from_slice(&env, b"invariant_path_2");
    let c2 = client.deposit(&token_id, &amount2, &owner, &salt2, &0, &None);
    client.withdraw(&token_id, &amount2, &c2, &owner, &salt2);

    assert_eq!(token_client.balance(&collector), 200);

    let total_balance = token_client.balance(&owner)
        + token_client.balance(&arbiter)
        + token_client.balance(&platform_wallet)
        + token_client.balance(&collector)
        + token_client.balance(&client.address);
    assert_eq!(total_balance, 50_000, "grand total must be conserved");
}
