# Aperture Transfer Hook

SPL Token-2022 Transfer Hook that enforces compliance verification on every token transfer. Blocks transfers that lack a verified proof record.

## How It Works

1. Token-2022 program invokes the transfer hook on every transfer
2. Hook checks HookConfig for active status
3. Hook derives the ProofRecord PDA from the verifier program
4. Hook reads the ProofRecord account and checks the `verified` flag
5. If no verified proof exists, the transfer is rejected

## Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize_hook_config` | Set up hook config with policy registry and verifier program IDs |
| `transfer_hook` | SPL Transfer Hook execute handler (called by Token-2022) |

## Account Structure

**HookConfig**: authority, policy_registry_program, verifier_program, active

## Registration

After deploying, register the hook with USDC and USDT mint accounts on Devnet:

```bash
spl-token create-token --transfer-hook <HOOK_PROGRAM_ID> --token-2022
```

## Build & Test

```bash
anchor build -p transfer_hook
anchor test
```
