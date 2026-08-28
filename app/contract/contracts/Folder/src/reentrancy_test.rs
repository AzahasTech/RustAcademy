//! Reentrancy behaviour of the escrow money paths.
//!
//! These tests drive the contract with a hostile token whose `transfer`
//! attempts to call back into the escrow contract.
//!
//! The outcome they pin down is that the Soroban host refuses the re-entrant
//! frame outright, so no escrow entry point is reachable from inside its own
//! execution. That platform guarantee is what makes the differing
//! state-write/transfer ordering across `escrow.rs` safe: two functions
//! (`deposit_with_commitment`, `partial_payment`) transfer before writing
//! state, and would otherwise let a nested call observe stale storage and slip
//! past a guard that had already passed.
//!
//! These tests exist so that if that assumption ever stops holding — a host
//! upgrade, or a refactor that reaches an entry point through some other
//! indirection — the resulting duplicate settlement is caught here rather than
//! in production.


use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, Bytes, BytesN, Env, Symbol,
};

use crate::{RustAcademyContract, RustAcademyContractClient};

// Re-entry outcome recorded by the hostile token so tests can assert on it.
const REENTRY_NOT_ATTEMPTED: u32 = 0;
const REENTRY_SUCCEEDED: u32 = 1;
const REENTRY_REJECTED: u32 = 2;
const REENTRY_BLOCKED_BY_HOST: u32 = 3;

// Which escrow call the token should re-enter with.
const MODE_DEPOSIT_WITH_COMMITMENT: u32 = 1;
const MODE_PARTIAL_PAYMENT: u32 = 2;

fn k(env: &Env, name: &str) -> Symbol {
    Symbol::new(env, name)
}

/// A token that calls back into the escrow contract the first time it is asked
/// to move funds, imitating a malicious or merely reentrant token.
#[contract]
pub struct HostileToken;

#[contractimpl]
impl HostileToken {
    /// Arm the callback. `mode` selects which escrow entry point to re-enter.
    pub fn arm(
        env: Env,
        escrow: Address,
        mode: u32,
        actor: Address,
        amount: i128,
        commitment: BytesN<32>,
    ) {
        env.storage().instance().set(&k(&env, "escrow"), &escrow);
        env.storage().instance().set(&k(&env, "mode"), &mode);
        env.storage().instance().set(&k(&env, "actor"), &actor);
        env.storage().instance().set(&k(&env, "amount"), &amount);
        env.storage()
            .instance()
            .set(&k(&env, "commitment"), &commitment);
        env.storage().instance().set(&k(&env, "armed"), &true);
        env.storage()
            .instance()
            .set(&k(&env, "result"), &REENTRY_NOT_ATTEMPTED);
        env.storage().instance().set(&k(&env, "transfers"), &0u32);
    }

    /// How many times `transfer` was called.
    pub fn transfers(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&k(&env, "transfers"))
            .unwrap_or(0)
    }

    /// Outcome of the re-entrant call: not attempted, succeeded, or rejected.
    pub fn reentry_result(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&k(&env, "result"))
            .unwrap_or(REENTRY_NOT_ATTEMPTED)
    }

    /// SEP-41 surface used by the escrow contract.
    pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
        let count: u32 = env
            .storage()
            .instance()
            .get(&k(&env, "transfers"))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&k(&env, "transfers"), &(count + 1));

        let armed: bool = env
            .storage()
            .instance()
            .get(&k(&env, "armed"))
            .unwrap_or(false);
        if !armed {
            return;
        }
        // Disarm first so the nested call does not recurse forever.
        env.storage().instance().set(&k(&env, "armed"), &false);

        let escrow: Address = env.storage().instance().get(&k(&env, "escrow")).unwrap();
        let mode: u32 = env.storage().instance().get(&k(&env, "mode")).unwrap();
        let actor: Address = env.storage().instance().get(&k(&env, "actor")).unwrap();
        let amount: i128 = env.storage().instance().get(&k(&env, "amount")).unwrap();
        let commitment: BytesN<32> = env
            .storage()
            .instance()
            .get(&k(&env, "commitment"))
            .unwrap();

        let client = RustAcademyContractClient::new(&env, &escrow);
        let recorded = match mode {
            MODE_DEPOSIT_WITH_COMMITMENT => {
                match client.try_deposit_with_commitment(
                    &actor,
                    &env.current_contract_address(),
                    &amount,
                    &commitment,
                    &0u64,
                    &None,
                ) {
                    Ok(_) => REENTRY_SUCCEEDED,
                    Err(Ok(_)) => REENTRY_REJECTED,
                    Err(Err(_)) => REENTRY_BLOCKED_BY_HOST,
                }
            }
            MODE_PARTIAL_PAYMENT => {
                match client.try_partial_payment(&commitment, &actor, &amount) {
                    Ok(_) => REENTRY_SUCCEEDED,
                    Err(Ok(_)) => REENTRY_REJECTED,
                    Err(Err(_)) => REENTRY_BLOCKED_BY_HOST,
                }
            }
            _ => REENTRY_NOT_ATTEMPTED,
        };
        env.storage().instance().set(&k(&env, "result"), &recorded);
    }

    pub fn balance(_env: Env, _id: Address) -> i128 {
        i128::MAX
    }
}

struct Harness<'a> {
    env: Env,
    client: RustAcademyContractClient<'a>,
    token: HostileTokenClient<'a>,
    token_address: Address,
    user: Address,
}

fn harness<'a>() -> Harness<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let escrow_id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(&env, &escrow_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let token_address = env.register(HostileToken, ());
    let token = HostileTokenClient::new(&env, &token_address);
    let user = Address::generate(&env);

    Harness {
        env,
        client,
        token,
        token_address,
        user,
    }
}

fn commitment_of(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

/// A hostile token must not be able to produce two funded deposits against a
/// single escrow record.
///
/// `deposit_with_commitment` transfers before it calls `put_escrow`, so a
/// nested call would see `has_escrow == false` and bypass the
/// `CommitmentAlreadyExists` guard. The host blocks the nested frame, so only
/// one transfer occurs and only one escrow is recorded.
#[test]
fn reentrant_deposit_cannot_bypass_duplicate_commitment_guard() {
    let h = harness();
    let commitment = commitment_of(&h.env, 0xAB);

    h.token.arm(
        &h.client.address,
        &MODE_DEPOSIT_WITH_COMMITMENT,
        &h.user,
        &1_000i128,
        &commitment,
    );

    h.client.deposit_with_commitment(
        &h.user,
        &h.token_address,
        &1_000i128,
        &commitment,
        &0u64,
        &None,
    );

    assert_eq!(
        h.token.reentry_result(),
        REENTRY_BLOCKED_BY_HOST,
        "the host must refuse a re-entrant call into deposit_with_commitment"
    );
    assert_eq!(
        h.token.transfers(),
        1,
        "only the outer deposit should have moved funds"
    );
}

/// A hostile token must not be able to push `amount_paid` past `amount_due`.
///
/// `partial_payment` transfers before it calls `put_escrow`, so a nested call
/// would recompute `remaining` from a stale `amount_paid` and slip past the
/// `Overpayment` rejection. The host blocks the nested frame.
#[test]
fn reentrant_partial_payment_cannot_bypass_overpayment_guard() {
    let h = harness();
    let salt = Bytes::from_slice(&h.env, b"reentrancy-partial");

    // Escrow expecting 1_000, funded with 400 up front.
    let commitment = h.client.deposit_partial(
        &h.token_address,
        &1_000i128,
        &400i128,
        &h.user,
        &salt,
        &0u64,
        &None,
    );

    // Arm a re-entrant top-up for the full remaining balance. Two of these
    // would take amount_paid to 1_600 against an amount_due of 1_000.
    h.token.arm(
        &h.client.address,
        &MODE_PARTIAL_PAYMENT,
        &h.user,
        &600i128,
        &commitment,
    );

    h.client.partial_payment(&commitment, &h.user, &600i128);

    assert_eq!(
        h.token.reentry_result(),
        REENTRY_BLOCKED_BY_HOST,
        "the host must refuse a re-entrant call into partial_payment"
    );
}
