//! Lifecycle transition tests for multi-arbiter (multi-sig) escrows.
//!
//! `deposit_with_arbiters` stores its arbiters in `EscrowEntry.arbiters` with
//! `arbiter: None`, but `dispute()` reads only `EscrowEntry.arbiter`. These
//! tests pin down that a multi-sig escrow can actually reach `Disputed` and be
//! resolved, which is the precondition for `vote_for_dispute` and
//! `resolve_dispute_multi_sig` being reachable at all.


use soroban_sdk::{testutils::Address as _, token, Address, Bytes, Env, Vec};

use crate::{types::EscrowStatus, RustAcademyContract, RustAcademyContractClient};

fn setup<'a>() -> (Env, RustAcademyContractClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(RustAcademyContract, ());
    let client = RustAcademyContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    (env, client, token)
}

/// A multi-sig escrow must be able to enter `Disputed`.
///
/// Without this, `vote_for_dispute` and `resolve_dispute_multi_sig` are
/// unreachable: both require `status == Disputed`, and `dispute()` is the only
/// transition into that state.
#[test]
fn multi_sig_escrow_can_be_disputed() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);
    let amount: i128 = 3_000;
    let salt = Bytes::from_slice(&env, b"multisig_dispute_lifecycle");

    token::StellarAssetClient::new(&env, &token).mint(&owner, &amount);

    let mut arbiters = Vec::new(&env);
    arbiters.push_back(Address::generate(&env));
    arbiters.push_back(Address::generate(&env));
    arbiters.push_back(Address::generate(&env));

    let commitment =
        client.deposit_with_arbiters(&token, &amount, &owner, &salt, &0u64, &arbiters, &2u32);

    assert_eq!(
        client.get_commitment_state(&commitment),
        Some(EscrowStatus::Pending),
        "escrow should start Pending"
    );

    let result = client.try_dispute(&commitment);
    assert!(
        result.is_ok(),
        "a multi-sig escrow must be disputable; otherwise its arbiters can never act"
    );

    assert_eq!(
        client.get_commitment_state(&commitment),
        Some(EscrowStatus::Disputed),
        "escrow should be Disputed after dispute()"
    );
}

/// Once a multi-sig escrow is disputed, its assigned arbiters must be able to
/// vote. This is the step that is dead code today.
#[test]
fn multi_sig_arbiters_can_vote_once_disputed() {
    let (env, client, token) = setup();
    let owner = Address::generate(&env);
    let amount: i128 = 3_000;
    let salt = Bytes::from_slice(&env, b"multisig_vote_lifecycle");

    token::StellarAssetClient::new(&env, &token).mint(&owner, &amount);

    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let mut arbiters = Vec::new(&env);
    arbiters.push_back(a1.clone());
    arbiters.push_back(a2.clone());

    let commitment =
        client.deposit_with_arbiters(&token, &amount, &owner, &salt, &0u64, &arbiters, &2u32);

    client.dispute(&commitment);

    let vote = client.try_vote_for_dispute(&a1, &commitment, &true);
    assert!(
        vote.is_ok(),
        "an assigned multi-sig arbiter must be able to vote on a disputed escrow"
    );
}
