use crate::{errors::RustAcademyError, storage, test_context::TestContext, types::Role};
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Vec};

#[test]
fn test_initial_admin_has_role() {
    let ctx = TestContext::with_admin();
    let roles = ctx.client.get_roles(&ctx.admin);
    assert!(roles.contains(Role::Admin));
}

#[test]
fn test_grant_and_revoke_role() {
    let ctx = TestContext::with_admin();
    let user = Address::generate(&ctx.env);

    // Grant Operator role
    ctx.client.grant_role(&ctx.admin, &user, &Role::Operator);
    let roles = ctx.client.get_roles(&user);
    assert!(roles.contains(Role::Operator));

    // Revoke Operator role
    ctx.client.revoke_role(&ctx.admin, &user, &Role::Operator);
    let roles = ctx.client.get_roles(&user);
    assert!(!roles.contains(Role::Operator));
}

#[test]
fn test_admin_transfer_requires_acceptance_and_can_be_cancelled() {
    let ctx = TestContext::with_admin();
    let pending_admin = ctx.bob.clone();

    ctx.client
        .propose_admin_transfer(&ctx.admin, &pending_admin);
    assert_eq!(
        ctx.client.get_pending_admin_transfer(),
        Some(pending_admin.clone())
    );

    ctx.client.cancel_admin_transfer(&ctx.admin);
    assert_eq!(ctx.client.get_pending_admin_transfer(), None);

    let cancelled_accept = ctx.client.try_accept_admin_transfer(&pending_admin);
    assert!(matches!(
        cancelled_accept,
        Err(Ok(RustAcademyError::NoPendingAdminTransfer))
    ));

    ctx.client
        .propose_admin_transfer(&ctx.admin, &pending_admin);
    ctx.client.accept_admin_transfer(&pending_admin);

    assert_eq!(ctx.client.get_admin(), Some(pending_admin.clone()));
    assert!(ctx.client.get_roles(&pending_admin).contains(Role::Admin));
    assert!(!ctx.client.get_roles(&ctx.admin).contains(Role::Admin));
}

#[test]
fn test_clear_roles_preserves_current_admin_role() {
    let ctx = TestContext::with_admin();

    ctx.client
        .grant_role(&ctx.admin, &ctx.admin, &Role::Operator);
    ctx.client
        .grant_role(&ctx.admin, &ctx.admin, &Role::Arbiter);

    ctx.client.clear_roles(&ctx.admin, &ctx.admin);

    let roles = ctx.client.get_roles(&ctx.admin);
    assert!(roles.contains(Role::Admin));
    assert!(!roles.contains(Role::Operator));
    assert!(!roles.contains(Role::Arbiter));
}

#[test]
fn test_cannot_revoke_admin_role_from_current_admin() {
    let ctx = TestContext::with_admin();

    let result = ctx
        .client
        .try_revoke_role(&ctx.admin, &ctx.admin, &Role::Admin);
    assert!(matches!(
        result,
        Err(Ok(RustAcademyError::InvalidRoleState))
    ));
}

#[test]
fn test_corrupt_admin_role_state_blocks_public_calls() {
    let ctx = TestContext::with_admin();

    ctx.env.as_contract(&ctx.client.address, || {
        let roles = Vec::new(&ctx.env);
        storage::set_roles(&ctx.env, &ctx.admin, &roles);
    });

    let result = ctx.client.try_set_paused(&ctx.admin, &true);
    assert!(
        result.is_err(),
        "set_paused must fail when admin role state is corrupted: {:?}",
        result
    );
}

#[test]
fn test_unauthorized_grant_fails() {
    let ctx = TestContext::with_admin();

    // Alice tries to grant a role to Bob
    let res = ctx
        .client
        .try_grant_role(&ctx.alice, &ctx.bob, &Role::Operator);
    assert!(res.is_err());
}

#[test]
fn test_operator_can_pause() {
    let ctx = TestContext::with_admin();
    let operator = ctx.alice.clone();

    // Grant Operator role to Alice
    ctx.client
        .grant_role(&ctx.admin, &operator, &Role::Operator);

    // Alice (Operator) pauses the contract
    ctx.client.set_paused(&operator, &true);
    assert!(ctx.client.is_paused());

    // Alice unpauses
    ctx.client.set_paused(&operator, &false);
    assert!(!ctx.client.is_paused());
}

#[test]
fn test_arbiter_role_resolution() {
    let ctx = TestContext::with_admin();
    let global_arbiter = ctx.bob.clone();

    // Grant Arbiter role to Bob
    ctx.client
        .grant_role(&ctx.admin, &global_arbiter, &Role::Arbiter);

    // Create a dispute WITHOUT a per-escrow arbiter (wait, deposit requires Option<Address>)
    // Actually, let's create it WITH a different arbiter but let the global one resolve it.
    let per_escrow_arbiter = Address::generate(&ctx.env);
    ctx.mint(&ctx.alice, 1000);
    let commitment = ctx.client.deposit(
        &ctx.token,
        &1000,
        &ctx.alice,
        &ctx.salt(b"salt"),
        &3600,
        &Some(per_escrow_arbiter.clone()),
    );

    // Dispute it
    ctx.client.dispute(&commitment);

    // Global arbiter (Bob) resolves it
    ctx.client
        .resolve_dispute(&global_arbiter, &commitment, &true, &ctx.alice);

    // Verify resolution
    let status = ctx.client.get_commitment_state(&commitment).unwrap();
    assert_eq!(status, crate::types::EscrowStatus::Refunded);
}

#[test]
fn test_insufficient_role_error() {
    let ctx = TestContext::with_admin();

    // Alice (no roles) tries to set fee config
    let res = ctx.client.try_set_fee_config(
        &ctx.alice,
        &crate::types::FeeConfig {
            fee_bps: 100,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );

    match res {
        Err(Ok(RustAcademyError::InsufficientRole)) => (),
        other => assert!(
            false,
            "Expected InsufficientRole error but got: {:?}",
            other
        ),
    }
}

// ============================================================================
// Issue #53 — function visibility / feature gating
// ============================================================================

/// `enable_privacy` is rejected while the `SetPrivacy` feature is paused.
#[test]
fn test_enable_privacy_blocked_when_set_privacy_feature_paused() {
    let ctx = TestContext::with_admin();
    ctx.client
        .pause_features(&ctx.admin, &(storage::PauseFlag::SetPrivacy as u64));

    let res = ctx.client.try_enable_privacy(&ctx.alice, &1);
    assert!(res.is_err());
}

/// `set_privacy` is rejected while the same `SetPrivacy` feature is paused.
#[test]
fn test_set_privacy_blocked_when_set_privacy_feature_paused() {
    let ctx = TestContext::with_admin();
    ctx.client
        .pause_features(&ctx.admin, &(storage::PauseFlag::SetPrivacy as u64));

    let res = ctx.client.try_set_privacy(&ctx.alice, &true);
    assert!(res.is_err());
}

/// `create_amount_commitment` is rejected while its feature flag is paused.
#[test]
fn test_create_amount_commitment_blocked_when_feature_paused() {
    let ctx = TestContext::with_admin();
    ctx.client.pause_features(
        &ctx.admin,
        &(storage::PauseFlag::CreateAmountCommitment as u64),
    );

    let salt = ctx.salt(b"gate");
    let res = ctx
        .client
        .try_create_amount_commitment(&ctx.alice, &1_000i128, &salt);
    assert!(res.is_err());
}

/// Sanity: the gated calls still succeed when their features are not paused.
#[test]
fn test_gated_privacy_and_commitment_work_when_unpaused() {
    let ctx = TestContext::with_admin();
    assert!(ctx.client.enable_privacy(&ctx.alice, &2));

    let salt = ctx.salt(b"ok");
    let _ = ctx
        .client
        .create_amount_commitment(&ctx.alice, &1_000i128, &salt);
}

// ============================================================================
// Issue #53 — standardized guard helper coverage
// ============================================================================

/// `set_privacy` requires the owner to authorize — succeeds when called by the owner.
#[test]
fn test_set_privacy_requires_owner_auth() {
    let ctx = TestContext::with_admin();
    // In tests all auths are mocked; calling set_privacy with alice means alice
    // authorizes her own address, which must succeed.
    let res = ctx.client.try_set_privacy(&ctx.alice, &true);
    assert!(res.is_ok(), "owner should be allowed to set their own privacy");
}

/// `set_privacy` is rejected when the contract has not been initialized.
#[test]
fn test_set_privacy_blocked_when_uninitialized() {
    // TestContext::new() does NOT call initialize()
    let ctx = TestContext::new();
    let res = ctx.client.try_set_privacy(&ctx.alice, &true);
    assert!(
        res.is_err(),
        "set_privacy must be blocked before contract is initialized"
    );
}

/// `create_escrow` is gated by `guard_initialized` and fails before initialization.
#[test]
fn test_create_escrow_blocked_when_uninitialized() {
    let ctx = TestContext::new();
    let res = ctx.client.try_create_escrow(&ctx.alice, &ctx.bob, &100u64);
    assert!(
        res.is_err(),
        "create_escrow must fail when the contract is not initialized"
    );
}

/// `create_escrow` succeeds after the contract is initialized and increments the counter.
#[test]
fn test_create_escrow_works_when_initialized() {
    let ctx = TestContext::with_admin();
    let counter = ctx.client.create_escrow(&ctx.alice, &ctx.bob, &0u64);
    assert_eq!(counter, 1u64, "first create_escrow call should return counter = 1");
}

/// `cleanup_stealth_escrow` uses `guard_initialized` — blocked before init.
#[test]
fn test_cleanup_stealth_escrow_blocked_when_uninitialized() {
    let ctx = TestContext::new();
    let dummy: soroban_sdk::BytesN<32> = soroban_sdk::BytesN::from_array(&ctx.env, &[0u8; 32]);
    let res = ctx.client.try_cleanup_stealth_escrow(&dummy);
    assert!(
        res.is_err(),
        "cleanup_stealth_escrow must fail when contract is not initialized"
    );
}

/// Deposit is blocked by the global pause flag (tests `guard_deposit`).
#[test]
fn test_deposit_blocked_when_globally_paused() {
    let ctx = TestContext::with_admin();
    ctx.client.set_paused(&ctx.admin, &true);

    ctx.mint(&ctx.alice, 1000);
    let res = ctx.client.try_deposit(
        &ctx.token,
        &1000i128,
        &ctx.alice,
        &ctx.salt(b"paused"),
        &0u64,
        &None,
    );
    assert!(
        res.is_err(),
        "deposit must be blocked when the contract is globally paused"
    );
}

/// Deposit is blocked by the feature-level pause flag (tests `guard_deposit` feature gate).
#[test]
fn test_deposit_blocked_when_deposit_feature_paused() {
    let ctx = TestContext::with_admin();
    ctx.client
        .pause_features(&ctx.admin, &(storage::PauseFlag::Deposit as u64));

    ctx.mint(&ctx.alice, 1000);
    let res = ctx.client.try_deposit(
        &ctx.token,
        &1000i128,
        &ctx.alice,
        &ctx.salt(b"feat_paused"),
        &0u64,
        &None,
    );
    assert!(
        res.is_err(),
        "deposit must be blocked when the Deposit feature flag is paused"
    );
}

/// Deposit is blocked in emergency mode (tests that `guard_deposit` includes emergency check).
#[test]
fn test_deposit_blocked_in_emergency_mode() {
    let ctx = TestContext::with_governance();
    ctx.client.activate_emergency_mode(&ctx.admin);

    ctx.mint(&ctx.alice, 1000);
    let res = ctx.client.try_deposit(
        &ctx.token,
        &1000i128,
        &ctx.alice,
        &ctx.salt(b"emergency_deposit"),
        &0u64,
        &None,
    );
    assert!(
        res.is_err(),
        "deposit must be blocked in emergency mode"
    );
}

/// Refund is blocked when the global pause flag is set (tests `guard_refund`).
#[test]
fn test_refund_blocked_when_globally_paused() {
    let ctx = TestContext::with_admin();

    ctx.mint(&ctx.alice, 500);
    let commitment = ctx.client.deposit(
        &ctx.token,
        &500i128,
        &ctx.alice,
        &ctx.salt(b"refund_pause"),
        &1u64, // 1 second timeout
        &None,
    );

    // Advance time past expiry
    ctx.advance_time(100);

    // Now pause
    ctx.client.set_paused(&ctx.admin, &true);

    let res = ctx.client.try_refund(&commitment, &ctx.alice);
    assert!(
        res.is_err(),
        "refund must be blocked when the contract is globally paused"
    );
}

/// Dispute operations are blocked when the contract is globally paused (tests `guard_dispute`).
#[test]
fn test_dispute_blocked_when_globally_paused() {
    let ctx = TestContext::with_admin();
    let arbiter = Address::generate(&ctx.env);

    ctx.mint(&ctx.alice, 1000);
    let commitment = ctx.client.deposit(
        &ctx.token,
        &1000i128,
        &ctx.alice,
        &ctx.salt(b"dispute_pause"),
        &0u64,
        &Some(arbiter.clone()),
    );

    ctx.client.set_paused(&ctx.admin, &true);

    let res = ctx.client.try_dispute(&commitment);
    assert!(
        res.is_err(),
        "dispute must be blocked when the contract is globally paused"
    );
}

/// Admin configuration calls are blocked in emergency mode (tests `guard_admin_config`).
#[test]
fn test_set_paused_blocked_in_emergency_mode() {
    let ctx = TestContext::with_governance();
    ctx.client.activate_emergency_mode(&ctx.admin);

    let res = ctx.client.try_set_paused(&ctx.admin, &false);
    assert!(
        res.is_err(),
        "set_paused must be blocked once emergency mode is active"
    );
}

/// `guard_initialized` returns Unauthorized when the contract is not yet initialized.
#[test]
fn test_guard_initialized_blocks_uninitialized_ops() {
    let ctx = TestContext::new();

    // cleanup_escrow uses guard_initialized
    let dummy: soroban_sdk::BytesN<32> = soroban_sdk::BytesN::from_array(&ctx.env, &[1u8; 32]);
    let res = ctx.client.try_cleanup_escrow(&dummy);
    assert!(
        res.is_err(),
        "cleanup_escrow must fail on an uninitialized contract"
    );
}

// ============================================================================
// Governance role boundary tests (Issue #561)
// ============================================================================

/// Governance role can be granted and verified.
#[test]
fn test_governance_role_can_be_granted() {
    let ctx = TestContext::with_admin();
    let gov = ctx.bob.clone();

    ctx.client.grant_role(&ctx.admin, &gov, &Role::Governance);
    let roles = ctx.client.get_roles(&gov);
    assert!(roles.contains(Role::Governance));
}

/// Governance role can be revoked by admin.
#[test]
fn test_governance_role_can_be_revoked() {
    let ctx = TestContext::with_admin();
    let gov = ctx.bob.clone();

    ctx.client.grant_role(&ctx.admin, &gov, &Role::Governance);
    ctx.client.revoke_role(&ctx.admin, &gov, &Role::Governance);
    let roles = ctx.client.get_roles(&gov);
    assert!(!roles.contains(Role::Governance));
}

/// Emergency mode activation requires Governance role.
#[test]
fn test_emergency_mode_requires_governance_role() {
    let ctx = TestContext::with_admin(); // admin has Admin role only, not Governance

    let res = ctx.client.try_activate_emergency_mode(&ctx.admin);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "emergency mode must require Governance role, not just Admin: {:?}",
        res
    );
}

/// Emergency mode activation succeeds with Governance role.
#[test]
fn test_emergency_mode_succeeds_with_governance_role() {
    let ctx = TestContext::with_governance(); // admin has both Admin + Governance

    let res = ctx.client.try_activate_emergency_mode(&ctx.admin);
    assert!(res.is_ok(), "emergency mode must succeed with Governance role: {:?}", res);
}

/// start_upgrade requires Governance role, not just Admin.
#[test]
fn test_start_upgrade_requires_governance_role() {
    let ctx = TestContext::with_admin();
    // Upgrade gate is enabled by default; set a valid upgrade window.
    let now = ctx.env.ledger().timestamp();
    ctx.client.set_upgrade_window(&ctx.admin, &now, &(now + 3600));

    let wasm_hash = BytesN::from_array(&ctx.env, &[0xaa; 32]);
    let res = ctx.client.try_start_upgrade(&ctx.admin, &2, &wasm_hash);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "start_upgrade must require Governance role: {:?}",
        res
    );
}

/// start_upgrade succeeds with Governance role.
#[test]
fn test_start_upgrade_succeeds_with_governance_role() {
    let ctx = TestContext::with_governance();
    // Advance ledger time so the upgrade window is active.
    ctx.advance_time(100);
    let now = ctx.env.ledger().timestamp();
    ctx.client.set_upgrade_window(&ctx.admin, &now, &(now + 3600));

    let wasm_hash = BytesN::from_array(&ctx.env, &[0xaa; 32]);
    let res = ctx.client.try_start_upgrade(&ctx.admin, &2, &wasm_hash);
    assert!(res.is_ok(), "start_upgrade must succeed with Governance role: {:?}", res);
}

/// cancel_upgrade requires Governance role.
#[test]
fn test_cancel_upgrade_requires_governance_role() {
    let ctx = TestContext::with_admin();
    let res = ctx.client.try_cancel_upgrade(&ctx.admin);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "cancel_upgrade must require Governance role: {:?}",
        res
    );
}

/// set_upgrade_gate requires Governance role.
#[test]
fn test_set_upgrade_gate_requires_governance_role() {
    let ctx = TestContext::with_admin();
    let res = ctx.client.try_set_upgrade_gate(&ctx.admin, &false);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "set_upgrade_gate must require Governance role: {:?}",
        res
    );
}

/// set_upgrade_gate succeeds with Governance role.
#[test]
fn test_set_upgrade_gate_succeeds_with_governance_role() {
    let ctx = TestContext::with_governance();
    let res = ctx.client.try_set_upgrade_gate(&ctx.admin, &false);
    assert!(res.is_ok(), "set_upgrade_gate must succeed with Governance role: {:?}", res);
}

/// Operator cannot activate emergency mode.
#[test]
fn test_operator_cannot_activate_emergency_mode() {
    let ctx = TestContext::with_admin();
    let operator = ctx.alice.clone();
    ctx.client.grant_role(&ctx.admin, &operator, &Role::Operator);

    let res = ctx.client.try_activate_emergency_mode(&operator);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "Operator must not be able to activate emergency mode: {:?}",
        res
    );
}

/// Operator cannot start an upgrade.
#[test]
fn test_operator_cannot_start_upgrade() {
    let ctx = TestContext::with_admin();
    let operator = ctx.alice.clone();
    ctx.client.grant_role(&ctx.admin, &operator, &Role::Operator);

    let wasm_hash = BytesN::from_array(&ctx.env, &[0xaa; 32]);
    let res = ctx.client.try_start_upgrade(&operator, &2, &wasm_hash);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "Operator must not be able to start upgrade: {:?}",
        res
    );
}

/// Admin-only actions (set_paused, set_platform_wallet) still work for Admin.
#[test]
fn test_admin_can_perform_admin_actions() {
    let ctx = TestContext::with_admin();

    // Admin can set_paused
    let res = ctx.client.try_set_paused(&ctx.admin, &true);
    assert!(res.is_ok(), "Admin must be able to set_paused: {:?}", res);
    ctx.client.set_paused(&ctx.admin, &false);

    // Admin can set_platform_wallet
    let res = ctx.client.try_set_platform_wallet(&ctx.admin, &ctx.bob);
    assert!(res.is_ok(), "Admin must be able to set_platform_wallet: {:?}", res);
}

/// Admin cannot perform governance actions without Governance role.
#[test]
fn test_admin_cannot_perform_governance_actions() {
    let ctx = TestContext::with_admin(); // Admin only, no Governance

    // Admin cannot activate emergency mode
    let res = ctx.client.try_activate_emergency_mode(&ctx.admin);
    assert!(matches!(res, Err(Ok(RustAcademyError::InsufficientRole))));

    // Admin cannot start upgrade
    let wasm_hash = BytesN::from_array(&ctx.env, &[0xaa; 32]);
    let res = ctx.client.try_start_upgrade(&ctx.admin, &2, &wasm_hash);
    assert!(matches!(res, Err(Ok(RustAcademyError::InsufficientRole))));

    // Admin cannot set_upgrade_gate
    let res = ctx.client.try_set_upgrade_gate(&ctx.admin, &false);
    assert!(matches!(res, Err(Ok(RustAcademyError::InsufficientRole))));
}

/// Unauthorized user (no roles) cannot perform any privileged operations.
#[test]
fn test_unauthorized_user_blocked_from_admin_and_governance() {
    let ctx = TestContext::with_admin();
    let nobody = ctx.bob.clone(); // no roles granted

    // No Admin: set_paused
    let res = ctx.client.try_set_paused(&nobody, &true);
    assert!(res.is_err());

    // No Admin: set_fee_config
    let res = ctx.client.try_set_fee_config(
        &nobody,
        &crate::types::FeeConfig {
            fee_bps: 100,
            schema_version: crate::types::FEE_CONFIG_SCHEMA_VERSION,
        },
    );
    assert!(res.is_err());

    // No Governance: activate_emergency_mode
    let res = ctx.client.try_activate_emergency_mode(&nobody);
    assert!(res.is_err());

    // No Governance: start_upgrade
    let wasm_hash = BytesN::from_array(&ctx.env, &[0xaa; 32]);
    let res = ctx.client.try_start_upgrade(&nobody, &2, &wasm_hash);
    assert!(res.is_err());

    // No Admin: grant_role
    let res = ctx.client.try_grant_role(&nobody, &ctx.alice, &Role::Operator);
    assert!(res.is_err());
}

/// Hook registration requires Admin role.
#[test]
fn test_register_hook_requires_admin() {
    let ctx = TestContext::with_admin();
    let nobody = ctx.bob.clone();

    let hook_addr = soroban_sdk::Address::generate(&ctx.env);
    let res = ctx.client.try_register_hook(&nobody, &hook_addr);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "register_hook must require Admin role: {:?}",
        res
    );
}

/// Hook registration succeeds for Admin.
#[test]
fn test_register_hook_succeeds_for_admin() {
    let ctx = TestContext::with_admin();
    let hook_addr = soroban_sdk::Address::generate(&ctx.env);
    let res = ctx.client.try_register_hook(&ctx.admin, &hook_addr);
    assert!(res.is_ok(), "register_hook must succeed for Admin: {:?}", res);
}

/// Hook unregistration requires Admin role.
#[test]
fn test_unregister_hook_requires_admin() {
    let ctx = TestContext::with_admin();
    let nobody = ctx.bob.clone();
    let hook_addr = soroban_sdk::Address::generate(&ctx.env);

    let res = ctx.client.try_unregister_hook(&nobody, &hook_addr);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "unregister_hook must require Admin role: {:?}",
        res
    );
}