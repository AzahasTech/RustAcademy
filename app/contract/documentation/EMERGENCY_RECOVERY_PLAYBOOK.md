# Soroban Smart Contract Emergency Recovery Playbook

This playbook provides actionable, step-by-step guidance for contract operators, admins, and developers responding to emergency situations, invalid fee configurations, admin lockouts, upgrade safety gate stalls, or corrupt event states.

---

## 1. Diagnostics & Emergency Status

The contract exposes built-in non-mutating health inspection functions via `metadata.rs`:

- **`contract_health(&env)`**: Returns status (`healthy`, `paused`, `upgrading`, `emergency`) along with granular boolean flags (`paused`, `emergency_mode`, `upgrade_in_progress`).
- **`pause_flags(&env)`**: Bitmask of paused functionalities (`0` = no features paused).
- **`upgrade_state(&env)`**: Inspection of timelocked upgrade window, pending WASM hash, and pending version.
- **`verify_artifact_integrity(&env)`**: Verifies stored WASM hash matches BLAKE3 build manifest source hash.

### Emergency Incident Matrix

| Incident Type | Severity | Symptoms | Immediate Diagnostic Command | Actionable Recovery Procedure |
|---|---|---|---|---|
| **Fee Routing Failure / Invalid Config** | High | Payout calls reverting due to zero/invalid collector address or out-of-range fee basis points. | Read fee router storage / call `contract_health`. | Execute `set_fee_config` with verified collector address and fee <= max cap; toggle pause flag if necessary. |
| **Upgrade Safety Gate Timelock Stall** | Critical | Contract upgrade blocked outside window or invalid WASM hash scheduled. | Inspect `upgrade_state(&env)`. | Call `clear_scheduled_upgrade(&env)` to purge stale WASM hash, then re-schedule with valid window. |
| **Granular Feature Lockout** | Medium | Specific user actions (e.g. bets or payout claims) reverting unexpectedly. | Check `pause_flags(&env)`. | Execute admin `set_pause_flags` to clear specific bitmask bits. |
| **Emergency Mode Activated** | Critical | Entire contract frozen (`status == "emergency"`). | Call `contract_health(&env)`. | Admin must inspect emergency reason log and invoke `clear_emergency_mode(&env)` once mitigated. |

---

## 2. Emergency Recovery Playbooks

### Playbook A: Mitigating Invalid Fee Configuration

1. **Diagnosis**:
   - Contract reverts payout claims with `InvalidFeeConfig` or zero-address error.
   - Inspect current fee configuration:
     ```rust
     let fee_config = storage::get_fee_config(&env);
     ```
2. **Mitigation**:
   - If fee collector is misconfigured, execute emergency update:
     ```bash
     soroban contract invoke --id <CONTRACT_ID> --source admin-key -- set_fee_config --collector <VALID_ADDRESS> --fee_bps 100
     ```
   - If payout claims must be temporarily isolated, set pause bitmask for payouts while investigating.

---

### Playbook B: Resetting Stalled / Invalid Contract Upgrade

1. **Diagnosis**:
   - Contract is in `upgrade_in_progress` or `status == "upgrading"`, but upgrade window expired (`window_end` passed) or incorrect WASM hash was scheduled.
   - Inspect upgrade state:
     ```rust
     let state = metadata::upgrade_state(&env);
     ```
2. **Recovery**:
   - Purge stale pending WASM and reset upgrade gate:
     ```bash
     soroban contract invoke --id <CONTRACT_ID> --source admin-key -- clear_scheduled_upgrade
     ```
   - Schedule new upgrade with proper delay window:
     ```bash
     soroban contract invoke --id <CONTRACT_ID> --source admin-key -- schedule_upgrade --new_wasm_hash <WASM_HASH> --delay_seconds 86400
     ```
   - Verify `upgrade_state` reports `window_active: false` until timelock elapses, after which `execute_upgrade` can be safely called.

---

### Playbook C: Recovering from Admin Key Lockout or Key Rotation

1. **Diagnosis**:
   - Admin account key compromised or rotated without contract metadata update.
2. **Mitigation**:
   - If multi-sig or backup admin is configured, invoke `propose_admin_transfer` using emergency backup key.
   - Verify event emission `AdminParamsChanged` to confirm authorization handoff.

---

## 3. Rollback & Post-Incident Verification

After executing recovery steps:
1. Call `metadata::contract_health(&env)` to ensure `status` returned is `healthy`.
2. Run standard integration tests (`cargo test`) to confirm contract invariant preservation.
3. Record incident summary, ledger sequence, transaction hashes, and updated parameters in operational audit log.
