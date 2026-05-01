use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
    instruction::{AccountMeta, Instruction},
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

solana_program::declare_id!("3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt");

const DISC_INIT_CONFIG: [u8; 8] = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const DISC_INIT_EXTRA_METAS: [u8; 8] = [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
// Closes an existing ExtraAccountMetaList PDA so the next DISC_INIT_EXTRA_METAS
// call can rebuild it with the new 5-account layout. Used once during the
// vUSDC -> aUSDC migration; gated by HookConfig.authority.
const DISC_CLOSE_EXTRA_METAS: [u8; 8] = [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const SPL_EXECUTE_DISC: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

/// Verifier program ID — bound at compile time so the transfer-hook cannot
/// be tricked into CPI'ing a malicious program.
const VERIFIER_PROGRAM: Pubkey = solana_program::pubkey!("AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU");

/// Anchor instruction discriminator for `record_payment` — first 8 bytes of
/// SHA-256("global:record_payment"). Verified at compile time of this file
/// by running:
///   node -e 'console.log(require("crypto").createHash("sha256").update("global:record_payment").digest().slice(0,8))'
const RECORD_PAYMENT_DISC: [u8; 8] = [226, 154, 10, 27, 9, 14, 148, 137];

/// Custom errors surfaced to clients via ProgramError::Custom(code).
const ERR_CONFIG_INACTIVE: u32 = 0x1000;
const ERR_NOT_COMPLIANT: u32 = 0x1002;
const ERR_NO_PENDING_PROOF: u32 = 0x1010;
const ERR_PROOF_RECIPIENT_MISMATCH: u32 = 0x1011;
const ERR_PROOF_MINT_MISMATCH: u32 = 0x1012;
const ERR_PROOF_AMOUNT_MISMATCH: u32 = 0x1013;
const ERR_PROOF_ALREADY_CONSUMED: u32 = 0x1014;
const ERR_BAD_OPERATOR_STATE: u32 = 0x1015;
const ERR_BAD_PROOF_RECORD: u32 = 0x1016;

#[derive(BorshSerialize, BorshDeserialize)]
pub struct HookConfig {
    pub is_initialized: bool,
    pub authority: Pubkey,
    pub policy_registry_program: Pubkey,
    pub verifier_program: Pubkey,
    pub active: bool,
}

impl HookConfig {
    pub const SIZE: usize = 1 + 32 + 32 + 32 + 1;
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let disc: [u8; 8] = instruction_data[..8].try_into().unwrap();
    match disc {
        DISC_INIT_CONFIG => process_initialize_hook_config(program_id, accounts, &instruction_data[8..]),
        DISC_INIT_EXTRA_METAS => process_initialize_extra_metas(program_id, accounts),
        DISC_CLOSE_EXTRA_METAS => process_close_extra_metas(program_id, accounts),
        SPL_EXECUTE_DISC => process_execute(program_id, accounts, &instruction_data[8..]),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Closes an existing ExtraAccountMetaList PDA, reclaiming its rent to the
/// HookConfig.authority signer. Required for the aUSDC layout migration:
/// the original PDA was sized for 3 extra accounts, the new layout
/// (Adim 6) needs 5, and program-owned PDAs cannot be resized.
///
/// Account layout:
///   0: extra_account_meta_list PDA (must be the one for `mint`)
///   1: mint
///   2: authority signer (must equal HookConfig.authority)
///   3: HookConfig PDA
fn process_close_extra_metas(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let extra_info = next_account_info(iter)?;
    let mint = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let hook_config = next_account_info(iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate the PDA derivation so we cannot be tricked into closing an
    // arbitrary account that happens to be program-owned.
    let (expected_pda, _) = Pubkey::find_program_address(
        &[b"extra-account-metas", mint.key.as_ref()],
        program_id,
    );
    if extra_info.key != &expected_pda {
        msg!("close_extra_metas: wrong PDA");
        return Err(ProgramError::InvalidAccountData);
    }
    if extra_info.owner != program_id {
        msg!("close_extra_metas: PDA not owned by this program");
        return Err(ProgramError::IllegalOwner);
    }

    // Validate authority via HookConfig.
    let (config_pda, _) = Pubkey::find_program_address(&[b"hook-config"], program_id);
    if hook_config.key != &config_pda {
        return Err(ProgramError::InvalidAccountData);
    }
    let config_data = hook_config.try_borrow_data()?;
    msg!("close_extra_metas: hook_config len = {}", config_data.len());
    // Try every plausible authority offset and accept whichever matches the
    // signer. Old Anchor deploys produced a 106-byte account; the native
    // BorshSerialize layout is 98 bytes. We fingerprint by length and slice
    // the 32 authority bytes from there.
    let auth_offset = if config_data.len() >= 106 {
        // Old Anchor deploy: 8-byte discriminator, then `authority: Pubkey`
        // is the first struct field. (`is_initialized` lives elsewhere in
        // that schema, not before the pubkey.)
        8
    } else if config_data.len() >= HookConfig::SIZE {
        // Native Borsh layout (this crate's HookConfig): is_initialized
        // bool first, then the 32-byte authority pubkey.
        1
    } else {
        return Err(ProgramError::InvalidAccountData);
    };
    let mut auth_bytes = [0u8; 32];
    auth_bytes.copy_from_slice(&config_data[auth_offset..auth_offset + 32]);
    let config_authority = Pubkey::new_from_array(auth_bytes);
    drop(config_data);
    msg!("close_extra_metas: cfg auth = {}", config_authority);
    msg!("close_extra_metas: signer    = {}", authority.key);
    if &config_authority != authority.key {
        msg!("close_extra_metas: authority mismatch");
        return Err(ProgramError::IllegalOwner);
    }

    // Drain lamports to the authority and zero the data.
    let lamports = extra_info.lamports();
    **extra_info.try_borrow_mut_lamports()? = 0;
    **authority.try_borrow_mut_lamports()? = authority
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let mut data = extra_info.try_borrow_mut_data()?;
    for byte in data.iter_mut() {
        *byte = 0;
    }
    // Re-assign to system program so the next create_account can take it.
    extra_info.assign(&solana_program::system_program::ID);

    msg!("ExtraAccountMetaList closed for mint {}", mint.key);
    Ok(())
}

fn process_initialize_hook_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config_info = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !authority.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 64 { return Err(ProgramError::InvalidInstructionData); }

    let policy_reg = Pubkey::from(<[u8; 32]>::try_from(&data[0..32]).unwrap());
    let verifier = Pubkey::from(<[u8; 32]>::try_from(&data[32..64]).unwrap());

    let (pda, bump) = Pubkey::find_program_address(&[b"hook-config"], program_id);
    if config_info.key != &pda { return Err(ProgramError::InvalidAccountData); }

    let space = HookConfig::SIZE;
    invoke_signed(
        &system_instruction::create_account(
            authority.key, config_info.key,
            Rent::get()?.minimum_balance(space),
            space as u64, program_id,
        ),
        &[authority.clone(), config_info.clone(), system.clone()],
        &[&[b"hook-config", &[bump]]],
    )?;

    let config = HookConfig {
        is_initialized: true,
        authority: *authority.key,
        policy_registry_program: policy_reg,
        verifier_program: verifier,
        active: true,
    };
    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;
    msg!("HookConfig initialized");
    Ok(())
}

/// Builds the ExtraAccountMetaList that the SPL Token-2022 transfer-hook
/// invocation consumes to resolve every account our `process_execute` reads.
///
/// Account layout the hook will see at execute time:
///   [0] source ATA               (Token-2022 default)
///   [1] mint                     (Token-2022 default)
///   [2] destination ATA          (Token-2022 default)
///   [3] authority (signer)       (Token-2022 default)
///   [4] extra_account_meta_list  (resolution PDA, ours)
///   [5] verifier program         (extra[0])
///   [6] HookConfig PDA           (extra[1])
///   [7] ComplianceStatus PDA     (extra[2], external)
///   [8] OperatorState PDA        (extra[3], external)
///   [9] ProofRecord PDA          (extra[4], external — seeded by the bytes
///                                 of OperatorState.pending_proof_hash)
fn process_initialize_extra_metas(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let extra_info = next_account_info(iter)?;
    let mint = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !authority.is_signer { return Err(ProgramError::MissingRequiredSignature); }

    let (pda, bump) = Pubkey::find_program_address(
        &[b"extra-account-metas", mint.key.as_ref()],
        program_id,
    );
    if extra_info.key != &pda { return Err(ProgramError::InvalidAccountData); }

    // OperatorState account layout (Anchor):
    //   8  disc
    //   32 operator
    //   8  daily_spent_lamports
    //   8  day_start_unix
    //   8  total_lifetime_payments
    //   32 pending_proof_hash      ← bytes 64..96
    //   1  bump
    // The transfer-hook resolver reads bytes 64..96 of extra[3] (OperatorState)
    // to derive the matching ProofRecord PDA without the dashboard ever
    // having to forward the hash via instruction data.
    const PENDING_HASH_OFFSET: u8 = 64;
    const PENDING_HASH_LEN: u8 = 32;

    let extra_metas = vec![
        // extra[0]: Verifier program (literal pubkey, no deps)
        ExtraAccountMeta::new_with_pubkey(&VERIFIER_PROGRAM, false, false)?,
        // extra[1]: HookConfig PDA from our program
        ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal { bytes: b"hook-config".to_vec() }],
            false, false,
        )?,
        // extra[2]: ComplianceStatus PDA from verifier program
        // program_index = account index 5 = Verifier Program (extra[0])
        ExtraAccountMeta::new_external_pda_with_seeds(
            5,
            &[
                Seed::Literal { bytes: b"compliance".to_vec() },
                Seed::AccountKey { index: 3 }, // authority
            ],
            false, false,
        )?,
        // extra[3]: OperatorState PDA from verifier program (writable — record_payment mutates it)
        ExtraAccountMeta::new_external_pda_with_seeds(
            5,
            &[
                Seed::Literal { bytes: b"operator_state".to_vec() },
                Seed::AccountKey { index: 3 }, // authority
            ],
            false, true,
        )?,
        // extra[4]: ProofRecord PDA from verifier program. Seeds:
        //   "proof" || authority || OperatorState.pending_proof_hash
        // The third seed comes from a slice of extra[3]'s account data — that
        // is what binds the resolution to "the proof the operator most
        // recently produced", with no instruction-data trust.
        ExtraAccountMeta::new_external_pda_with_seeds(
            5,
            &[
                Seed::Literal { bytes: b"proof".to_vec() },
                Seed::AccountKey { index: 3 },
                Seed::AccountData {
                    account_index: 8, // OperatorState (extra[3] = global index 8)
                    data_index: PENDING_HASH_OFFSET,
                    length: PENDING_HASH_LEN,
                },
            ],
            false, true, // writable — record_payment marks it consumed
        )?,
    ];

    let size = ExtraAccountMetaList::size_of(extra_metas.len())?;
    invoke_signed(
        &system_instruction::create_account(
            authority.key, extra_info.key,
            Rent::get()?.minimum_balance(size),
            size as u64, program_id,
        ),
        &[authority.clone(), extra_info.clone(), system.clone()],
        &[&[b"extra-account-metas", mint.key.as_ref(), &[bump]]],
    )?;

    let mut data = extra_info.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_metas)?;
    msg!(
        "ExtraAccountMetaList initialized with {} extra accounts (HookConfig + ComplianceStatus + OperatorState + ProofRecord + verifier)",
        extra_metas.len()
    );
    Ok(())
}

/// Helper: read a Pubkey out of an Anchor account whose layout begins with
/// [8 bytes discriminator][32 bytes Pubkey ...]. The `field_offset` is the
/// byte position AFTER the discriminator, so e.g. ProofRecord.recipient is
/// at offset 8 + 32 + 32 + 32 + 32 + 32 + 8 + 1 + 1 = ...
fn read_account_bytes_32(account: &AccountInfo, byte_offset: usize) -> Result<[u8; 32], ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() < byte_offset + 32 {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&data[byte_offset..byte_offset + 32]);
    Ok(out)
}

fn read_account_u64(account: &AccountInfo, byte_offset: usize) -> Result<u64, ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() < byte_offset + 8 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(u64::from_le_bytes(data[byte_offset..byte_offset + 8].try_into().unwrap()))
}

fn read_account_bool(account: &AccountInfo, byte_offset: usize) -> Result<bool, ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() <= byte_offset {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(data[byte_offset] == 1)
}

fn process_execute(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Token-2022 stuffs the transfer amount into the first 8 bytes of the
    // execute instruction data (after the SPL discriminator, which we already
    // stripped in process_instruction).
    let amount = if data.len() >= 8 {
        u64::from_le_bytes(data[..8].try_into().unwrap_or([0u8; 8]))
    } else { 0 };

    if accounts.len() < 10 {
        msg!("Hook: need 10 accounts (got {}), are extra metas migrated?", accounts.len());
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // Pull each account by its index in the resolved layout.
    let _source = &accounts[0];
    let mint = &accounts[1];
    let dest = &accounts[2];
    let authority = &accounts[3];
    let _extra_metas = &accounts[4];
    let _verifier_program = &accounts[5];
    let hook_config = &accounts[6];
    let compliance_status = &accounts[7];
    let operator_state = &accounts[8];
    let proof_record = &accounts[9];

    // ---- 1. Hook is enabled --------------------------------------------------
    let config_data = hook_config.try_borrow_data()?;
    let active = if config_data.len() >= 106 {
        // Anchor-layout legacy account: active flag at byte 104 (after disc +
        // is_initialized + 3 pubkeys = 8 + 1 + 96).
        config_data[104] == 1
    } else if config_data.len() >= HookConfig::SIZE {
        let c = HookConfig::try_from_slice(&config_data)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        c.active
    } else {
        return Err(ProgramError::InvalidAccountData);
    };
    drop(config_data);
    if !active {
        return Err(ProgramError::Custom(ERR_CONFIG_INACTIVE));
    }

    // ---- 2. ComplianceStatus says the operator is currently compliant -------
    if compliance_status.owner != &VERIFIER_PROGRAM {
        return Err(ProgramError::Custom(ERR_NOT_COMPLIANT));
    }
    // ComplianceStatus layout: 8 disc + 32 operator + 1 is_compliant ...
    if !read_account_bool(compliance_status, 8 + 32)? {
        return Err(ProgramError::Custom(ERR_NOT_COMPLIANT));
    }

    // ---- 3. OperatorState owned by verifier and has a pending proof ---------
    if operator_state.owner != &VERIFIER_PROGRAM {
        return Err(ProgramError::Custom(ERR_BAD_OPERATOR_STATE));
    }
    // OperatorState pending_proof_hash at byte 8 + 32 + 8 + 8 + 8 = 64
    let pending_hash = read_account_bytes_32(operator_state, 64)?;
    if pending_hash == [0u8; 32] {
        return Err(ProgramError::Custom(ERR_NO_PENDING_PROOF));
    }

    // ---- 4. ProofRecord owned by verifier, not yet consumed, fields match --
    if proof_record.owner != &VERIFIER_PROGRAM {
        return Err(ProgramError::Custom(ERR_BAD_PROOF_RECORD));
    }
    // ProofRecord layout (Anchor):
    //   8 disc
    //   32 operator
    //   32 policy_id
    //   32 proof_hash
    //   32 image_id (8 * u32 = 32 bytes)
    //   32 journal_digest
    //   8 timestamp
    //   1 verified
    //   1 consumed
    //   32 recipient
    //   32 token_mint
    //   8 amount_lamports
    //   1 bump
    const OFF_VERIFIED: usize = 8 + 32 + 32 + 32 + 32 + 32 + 8;            // 176
    const OFF_CONSUMED: usize = OFF_VERIFIED + 1;                          // 177
    const OFF_RECIPIENT: usize = OFF_CONSUMED + 1;                         // 178
    const OFF_TOKEN_MINT: usize = OFF_RECIPIENT + 32;                      // 210
    const OFF_AMOUNT: usize = OFF_TOKEN_MINT + 32;                         // 242

    if read_account_bool(proof_record, OFF_CONSUMED)? {
        return Err(ProgramError::Custom(ERR_PROOF_ALREADY_CONSUMED));
    }
    let proof_recipient = read_account_bytes_32(proof_record, OFF_RECIPIENT)?;
    let proof_mint = read_account_bytes_32(proof_record, OFF_TOKEN_MINT)?;
    let proof_amount = read_account_u64(proof_record, OFF_AMOUNT)?;

    // ---- 5. Match transfer parameters ---------------------------------------
    // dest is the destination ATA. Token-2022 ATA layout:
    //   0..32  mint
    //   32..64 owner
    let dest_data = dest.try_borrow_data()?;
    if dest_data.len() < 64 {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut dest_owner = [0u8; 32];
    dest_owner.copy_from_slice(&dest_data[32..64]);
    drop(dest_data);

    if dest_owner != proof_recipient {
        msg!("Hook REJECTED: recipient mismatch");
        return Err(ProgramError::Custom(ERR_PROOF_RECIPIENT_MISMATCH));
    }
    if mint.key.to_bytes() != proof_mint {
        msg!("Hook REJECTED: mint mismatch");
        return Err(ProgramError::Custom(ERR_PROOF_MINT_MISMATCH));
    }
    if amount != proof_amount {
        msg!("Hook REJECTED: amount mismatch (got {} want {})", amount, proof_amount);
        return Err(ProgramError::Custom(ERR_PROOF_AMOUNT_MISMATCH));
    }

    // ---- 6. CPI verifier::record_payment to advance daily_spent atomically -
    // Account order MUST match RecordPayment's #[derive(Accounts)] in
    // programs/verifier/src/instructions/record_payment.rs:
    //   0: operator (read)
    //   1: operator_state (mut)
    //   2: proof_record (mut)
    let mut cpi_data = Vec::with_capacity(8 + 32 + 32 + 8);
    cpi_data.extend_from_slice(&RECORD_PAYMENT_DISC);
    cpi_data.extend_from_slice(&proof_recipient);
    cpi_data.extend_from_slice(&proof_mint);
    cpi_data.extend_from_slice(&amount.to_le_bytes());

    let ix = Instruction {
        program_id: VERIFIER_PROGRAM,
        accounts: vec![
            AccountMeta::new_readonly(*authority.key, false),
            AccountMeta::new(*operator_state.key, false),
            AccountMeta::new(*proof_record.key, false),
        ],
        data: cpi_data,
    };

    invoke(
        &ix,
        &[authority.clone(), operator_state.clone(), proof_record.clone()],
    )?;

    msg!(
        "Hook PASSED + recorded: {} lamports for {} -> {}",
        amount, authority.key, Pubkey::from(proof_recipient)
    );
    Ok(())
}
