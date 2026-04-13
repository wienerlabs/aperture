use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

solana_program::declare_id!("DjM7B4WY3QmZsVSS3hJcmr3TUwVokZxbmi2HaykTjAW");

const DISC_INIT_CONFIG: [u8; 8] = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const DISC_INIT_EXTRA_METAS: [u8; 8] = [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const SPL_EXECUTE_DISC: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

// Verifier program ID (for ComplianceStatus PDA derivation)
const VERIFIER_PROGRAM: Pubkey = solana_program::pubkey!("HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr");

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
        SPL_EXECUTE_DISC => process_execute(program_id, accounts, &instruction_data[8..]),
        _ => Err(ProgramError::InvalidInstructionData),
    }
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
        &system_instruction::create_account(authority.key, config_info.key, Rent::get()?.minimum_balance(space), space as u64, program_id),
        &[authority.clone(), config_info.clone(), system.clone()],
        &[&[b"hook-config", &[bump]]],
    )?;

    let config = HookConfig { is_initialized: true, authority: *authority.key, policy_registry_program: policy_reg, verifier_program: verifier, active: true };
    config.serialize(&mut &mut config_info.try_borrow_mut_data()?[..])?;
    msg!("HookConfig initialized");
    Ok(())
}

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
        &[b"extra-account-metas", mint.key.as_ref()], program_id,
    );
    if extra_info.key != &pda { return Err(ProgramError::InvalidAccountData); }

    // Extra accounts for the hook:
    // 0: HookConfig PDA (seeds: ["hook-config"], this program)
    // 1: ComplianceStatus PDA (seeds: ["compliance", authority], verifier program)
    //    authority is account index 3 in the Token-2022 CPI
    // Order matters: dependencies must come BEFORE dependents.
    // Full account list: 0=source, 1=mint, 2=dest, 3=authority, 4=extraMetasPDA
    // extra[0] = Verifier Program (index 5, literal, no deps)
    // extra[1] = HookConfig PDA (index 6, our program, no deps)
    // extra[2] = ComplianceStatus PDA (index 7, external PDA from program at index 5)
    let extra_metas = vec![
        // extra[0]: Verifier program (literal pubkey, resolved first)
        ExtraAccountMeta::new_with_pubkey(&VERIFIER_PROGRAM, false, false)?,
        // extra[1]: HookConfig PDA from our program
        ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal { bytes: b"hook-config".to_vec() }],
            false, false,
        )?,
        // extra[2]: ComplianceStatus PDA from verifier program (at index 5 = extra[0])
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // program_index = account index 5 = Verifier Program
            &[
                Seed::Literal { bytes: b"compliance".to_vec() },
                Seed::AccountKey { index: 3 }, // authority (sender)
            ],
            false, false,
        )?,
    ];

    let size = ExtraAccountMetaList::size_of(extra_metas.len())?;
    invoke_signed(
        &system_instruction::create_account(authority.key, extra_info.key, Rent::get()?.minimum_balance(size), size as u64, program_id),
        &[authority.clone(), extra_info.clone(), system.clone()],
        &[&[b"extra-account-metas", mint.key.as_ref(), &[bump]]],
    )?;

    let mut data = extra_info.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_metas)?;
    msg!("ExtraAccountMetaList initialized with 3 extra accounts (HookConfig + ComplianceStatus + VerifierProgram)");
    Ok(())
}

fn process_execute(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let amount = if data.len() >= 8 {
        u64::from_le_bytes(data[..8].try_into().unwrap_or([0u8; 8]))
    } else { 0 };

    // Token-2022 CPI account order:
    // 0: source, 1: mint, 2: dest, 3: authority
    // 4: extra_account_meta_list
    // 5: Verifier Program (extra[0])
    // 6: HookConfig PDA (extra[1])
    // 7: ComplianceStatus PDA (extra[2])

    if accounts.len() < 8 {
        msg!("Hook: need 8 accounts, got {}", accounts.len());
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let authority = &accounts[3];
    let hook_config = &accounts[6];
    let compliance_status = &accounts[7];

    // Validate HookConfig
    let (expected_config, _) = Pubkey::find_program_address(&[b"hook-config"], program_id);
    if hook_config.key != &expected_config {
        msg!("Hook: wrong config PDA");
        return Err(ProgramError::InvalidAccountData);
    }

    // Read active flag from config (support old Anchor format: active at byte 104)
    let config_data = hook_config.try_borrow_data()?;
    let active = if config_data.len() >= 106 {
        config_data[104] == 1 // Anchor format
    } else if config_data.len() >= HookConfig::SIZE {
        let c = HookConfig::try_from_slice(&config_data).map_err(|_| ProgramError::InvalidAccountData)?;
        c.active
    } else {
        return Err(ProgramError::InvalidAccountData);
    };
    drop(config_data);

    if !active {
        msg!("Hook: disabled");
        return Err(ProgramError::Custom(0x1000));
    }

    // Validate ComplianceStatus PDA
    let (expected_compliance, _) = Pubkey::find_program_address(
        &[b"compliance", authority.key.as_ref()],
        &VERIFIER_PROGRAM,
    );
    if compliance_status.key != &expected_compliance {
        msg!("Hook: wrong compliance status PDA");
        return Err(ProgramError::InvalidAccountData);
    }

    // Check if ComplianceStatus exists and is_compliant
    if compliance_status.owner != &VERIFIER_PROGRAM {
        msg!("Hook REJECTED: no compliance status for {}", authority.key);
        return Err(ProgramError::Custom(0x1001));
    }

    let status_data = compliance_status.try_borrow_data()?;
    // Anchor ComplianceStatus layout:
    // 8 (disc) + 32 (operator) + 1 (is_compliant) + 32 (last_proof_hash) + 8 (last_verified) + 4 (total) + 1 (bump)
    // is_compliant at offset 40
    if status_data.len() < 41 {
        msg!("Hook REJECTED: compliance status not initialized for {}", authority.key);
        return Err(ProgramError::Custom(0x1001));
    }

    let is_compliant = status_data[40] == 1;
    if !is_compliant {
        msg!("Hook REJECTED: operator {} is not compliant", authority.key);
        return Err(ProgramError::Custom(0x1002));
    }

    msg!("Hook PASSED: {} tokens verified for {}", amount, authority.key);
    Ok(())
}
