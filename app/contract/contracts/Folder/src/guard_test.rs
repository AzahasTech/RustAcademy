use crate::{
    errors::RustAcademyError,
    storage::PauseFlag,
    types::Role,
    RustAcademyContract, RustAcademyContractClient,
};

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Bytes, BytesN, Env,
};

/// Helper function to generate a test commitment
pub fn get_test_commitment(env: &Env) -> BytesN<32> {
    let salt = BytesN::from_array(env, &[0u8; 32]);
    env.crypto().sha256(&salt.into()).into()
}

/// Test case structure for table-driven guard tests
struct GuardTestCase {
    name: &'static str,
    test_fn: fn(&Env, &Address) -> Result<(), RustAcademyError>,
    should_succeed: bool,
}

/// Table of guard test cases
const GUARD_TEST_TABLE: &[GuardTestCase] = &[
    GuardTestCase {
        name: "test_initialized_contract_allows_guard_initialized",
        test_fn: test_initialized_contract_allows_guard_initialized,
        should_succeed: true,
    },
    GuardTestCase {
        name: "test_emergency_mode_blocks_deposits",
        test_fn: test_emergency_mode_blocks_deposits,
        should_succeed: false,
    },
    GuardTestCase {
        name: "test_emergency_mode_does_not_block_withdrawals",
        test_fn: test_emergency_mode_does_not_block_withdrawals,
        should_succeed: true,
    },
    GuardTestCase {
        name: "test_emergency_mode_blocks_admin_config",
        test_fn: test_emergency_mode_blocks_admin_config,
        should_succeed: false,
    },
    GuardTestCase {
        name: "test_global_pause_blocks_operations",
        test_fn: test_global_pause_blocks_operations,
        should_succeed: false,
    },
];

// ─────────────────────────────────────────────────────────────────────────
// Governance boundary tests
// ─────────────────────────────────────────────────────────────────────────

/// Helper: set up a contract with admin + governance roles, and a valid upgrade window.
fn setup_governance_contract(env: &Env) -> (Address, RustAcademyContractClient) {
    let admin = Address::generate(env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(env, &contract_id);
    client.initialize(&admin);
    // Grant Governance role to admin
    client.grant_role(&admin, &admin, &Role::Governance);
    // Enable upgrade gate and set a valid window
    client.set_upgrade_gate(&admin, &true);
    let now = env.ledger().timestamp();
    client.set_upgrade_window(&admin, &now, &(now + 3600));
    (admin, client)
}

/// Emergency mode activation rejects Admin-only callers.
#[test]
fn test_emergency_mode_rejects_admin_without_governance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(&env, &contract_id);
    client.initialize(&admin);
    // Admin does NOT have Governance role

    let res = client.try_activate_emergency_mode(&admin);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "Admin without Governance role must be rejected for emergency mode: {:?}",
        res
    );
}

/// Emergency mode activation succeeds with Governance role.
#[test]
fn test_emergency_mode_accepted_with_governance_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client) = setup_governance_contract(&env);

    let res = client.try_activate_emergency_mode(&admin);
    assert!(res.is_ok(), "Governance role must be accepted for emergency mode: {:?}", res);
}

/// start_upgrade rejects Admin without Governance role.
#[test]
fn test_start_upgrade_rejects_admin_without_governance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.set_upgrade_gate(&admin, &true);
    let now = env.ledger().timestamp();
    client.set_upgrade_window(&admin, &now, &(now + 3600));

    let wasm_hash = BytesN::from_array(&env, &[0xbb; 32]);
    let res = client.try_start_upgrade(&admin, &2, &wasm_hash);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "start_upgrade must require Governance role: {:?}",
        res
    );
}

/// set_upgrade_gate rejects Admin without Governance role.
#[test]
fn test_set_upgrade_gate_rejects_admin_without_governance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let res = client.try_set_upgrade_gate(&admin, &false);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "set_upgrade_gate must require Governance role: {:?}",
        res
    );
}

/// register_hook rejects callers without Admin role.
#[test]
fn test_register_hook_rejects_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let nobody = Address::generate(&env);
    let hook_addr = Address::generate(&env);
    let res = client.try_register_hook(&nobody, &hook_addr);
    assert!(
        matches!(res, Err(Ok(RustAcademyError::InsufficientRole))),
        "register_hook must reject non-admin caller: {:?}",
        res
    );
}

/// register_hook accepts Admin role.
#[test]
fn test_register_hook_accepts_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let hook_addr = Address::generate(&env);
    let res = client.try_register_hook(&admin, &hook_addr);
    assert!(res.is_ok(), "register_hook must accept Admin: {:?}", res);
}

fn setup_initialized_contract(env: &Env) -> (Address, RustAcademyContractClient) {
    let admin = Address::generate(env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(env, &contract_id);
    client.initialize(&admin);
    (admin, client)
}

fn test_initialized_contract_allows_guard_initialized(env: &Env, _caller: &Address) -> Result<(), RustAcademyError> {
    let admin = Address::generate(env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(env, &contract_id);
    client.initialize(&admin);
    
    let user = Address::generate(env);
    client.set_privacy(&user, &true);
    Ok(())
}

fn test_emergency_mode_blocks_deposits(env: &Env, _caller: &Address) -> Result<(), RustAcademyError> {
    let admin = Address::generate(env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(env, &contract_id);
    client.initialize(&admin);
    
    let user = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(Address::generate(env)).address();
    let commitment = get_test_commitment(env);
    let salt = Bytes::from_slice(env, b"test_salt");
    
    client.activate_emergency_mode(&admin);
    
    let result = client.try_deposit(&token, &1000, &user, &salt, &0u64, &Option::None);
    match result {
        Err(_) => Ok(()),
        _ => Err(RustAcademyError::ContractPaused),
    }
}

fn test_emergency_mode_does_not_block_withdrawals(env: &Env, _caller: &Address) -> Result<(), RustAcademyError> {
    let admin = Address::generate(env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(env, &contract_id);
    client.initialize(&admin);
    
    let user = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(Address::generate(env)).address();
    let commitment = get_test_commitment(env);
    let salt = Bytes::from_slice(env, b"test_salt");
    
    // Setup escrow
    let token_client = token::StellarAssetClient::new(env, &token);
    env.mock_all_auths();
    token_client.mint(&client.address, &1000);
    
    client.activate_emergency_mode(&admin);
    
    // Withdrawal should still work
    let result = client.try_withdraw(&token, &1000, &commitment, &user, &salt);
    match result {
        Ok(_) => Ok(()),
        _ => Err(RustAcademyError::InternalError),
    }
}

fn test_emergency_mode_blocks_admin_config(env: &Env, _caller: &Address) -> Result<(), RustAcademyError> {
    let admin = Address::generate(env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(env, &contract_id);
    client.initialize(&admin);
    
    client.activate_emergency_mode(&admin);
    
    let new_admin = Address::generate(env);
    let result = client.try_set_admin(&admin, &new_admin);
    match result {
        Err(_) => Ok(()),
        _ => Err(RustAcademyError::ContractPaused),
    }
}

fn test_global_pause_blocks_operations(env: &Env, _caller: &Address) -> Result<(), RustAcademyError> {
    let admin = Address::generate(env);
    let contract_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(env, &contract_id);
    client.initialize(&admin);
    
    client.set_paused(&admin, &true);
    
    let user = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(Address::generate(env)).address();
    let commitment = get_test_commitment(env);
    let salt = Bytes::from_slice(env, b"test_salt");
    
    let result = client.try_deposit(&token, &1000, &user, &salt, &0u64, &Option::None);
    match result {
        Err(_) => Ok(()),
        _ => Err(RustAcademyError::ContractPaused),
    }
}

#[test]
fn test_guard_test_table() {
    let env = Env::default();
    env.mock_all_auths();
    
    for test_case in GUARD_TEST_TABLE {
        let caller = Address::generate(&env);
        let result = (test_case.test_fn)(&env, &caller);
        
        if test_case.should_succeed {
            assert!(result.is_ok(), "Test {} should succeed but failed", test_case.name);
        } else {
            assert!(result.is_err(), "Test {} should fail but succeeded", test_case.name);
        }
    }
}
