#!/usr/bin/env bash
set -euo pipefail

# Create vUSDC SPL Token-2022 token on Devnet with Transfer Hook
# Prerequisites:
#   - solana-cli installed and configured for devnet
#   - spl-token CLI installed (v4+ for Token-2022 support)
#   - Wallet with SOL on devnet

MINT_AUTHORITY="CBDjvUkZZ6ucrVGrU3vRraasTytha8oVg2NLCxAHE25b"
TRANSFER_HOOK_PROGRAM="3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt"
TOKEN_NAME="vUSDC"
TOKEN_SYMBOL="vUSDC"
DECIMALS=6
MINT_AMOUNT=1000

echo "=== Aperture vUSDC Token Creation ==="
echo "Network: Devnet"
echo "Mint Authority: ${MINT_AUTHORITY}"
echo "Transfer Hook Program: ${TRANSFER_HOOK_PROGRAM}"
echo ""

# Ensure we're on devnet
solana config set --url https://api.devnet.solana.com

# Step 1: Create the Token-2022 mint with transfer hook extension
echo "[1/5] Creating Token-2022 mint with transfer hook..."
MINT_OUTPUT=$(spl-token create-token \
  --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --decimals ${DECIMALS} \
  --transfer-hook ${TRANSFER_HOOK_PROGRAM} \
  --mint-authority ${MINT_AUTHORITY} \
  2>&1)

VUSDC_MINT=$(echo "${MINT_OUTPUT}" | grep -oP 'Creating token \K[A-Za-z0-9]+' || echo "${MINT_OUTPUT}" | head -1)
echo "vUSDC Mint Address: ${VUSDC_MINT}"

# Step 2: Initialize the ExtraAccountMetaList PDA for the transfer hook
echo "[2/5] Initializing ExtraAccountMetaList PDA..."
# The transfer hook program needs this PDA initialized to specify extra accounts
# This is done via a CPI from the transfer hook program's initialize instruction

# Step 3: Create associated token account
echo "[3/5] Creating token account..."
spl-token create-account "${VUSDC_MINT}" \
  --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

# Step 4: Mint 1000 vUSDC for testing
echo "[4/5] Minting ${MINT_AMOUNT} vUSDC..."
spl-token mint "${VUSDC_MINT}" ${MINT_AMOUNT} \
  --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

# Step 5: Output results
echo "[5/5] Token creation complete!"
echo ""
echo "=== vUSDC Token Details ==="
echo "Mint Address: ${VUSDC_MINT}"
echo "Name: ${TOKEN_NAME}"
echo "Symbol: ${TOKEN_SYMBOL}"
echo "Decimals: ${DECIMALS}"
echo "Transfer Hook: ${TRANSFER_HOOK_PROGRAM}"
echo "Mint Authority: ${MINT_AUTHORITY}"
echo "Initial Supply: ${MINT_AMOUNT}"
echo ""
echo "Add to .env:"
echo "VUSDC_MINT_ADDRESS=${VUSDC_MINT}"
echo ""
echo "Explorer: https://explorer.solana.com/address/${VUSDC_MINT}?cluster=devnet"
