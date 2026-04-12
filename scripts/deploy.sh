#!/usr/bin/env bash
set -euo pipefail

NETWORK="${1:-devnet}"
SOLANA_URL="https://api.devnet.solana.com"

echo "=== Aperture Deployment Script ==="
echo "Network: $NETWORK"
echo ""

# Check prerequisites
command -v solana >/dev/null 2>&1 || { echo "solana CLI not found. Install from https://docs.solanalabs.com/cli/install"; exit 1; }
command -v anchor >/dev/null 2>&1 || { echo "anchor CLI not found. Install with: cargo install --git https://github.com/coral-xyz/anchor anchor-cli"; exit 1; }

# Set Solana config
echo "[1/5] Configuring Solana CLI for $NETWORK..."
solana config set --url "$SOLANA_URL"

# Check wallet balance
BALANCE=$(solana balance --lamports 2>/dev/null || echo "0")
echo "Wallet balance: $BALANCE lamports"

if [ "$BALANCE" = "0" ]; then
    echo "Requesting airdrop..."
    solana airdrop 2
    sleep 5
fi

# Build Anchor programs
echo ""
echo "[2/5] Building Anchor programs..."
anchor build

# Deploy Policy Registry
echo ""
echo "[3/5] Deploying Policy Registry..."
POLICY_REGISTRY_ID=$(anchor deploy --program-name policy_registry 2>&1 | grep "Program Id:" | awk '{print $3}')
echo "Policy Registry deployed: $POLICY_REGISTRY_ID"

# Deploy Verifier
echo ""
echo "[4/5] Deploying Verifier..."
VERIFIER_ID=$(anchor deploy --program-name verifier 2>&1 | grep "Program Id:" | awk '{print $3}')
echo "Verifier deployed: $VERIFIER_ID"

# Deploy Transfer Hook
echo ""
echo "[5/5] Deploying Transfer Hook..."
TRANSFER_HOOK_ID=$(anchor deploy --program-name transfer_hook 2>&1 | grep "Program Id:" | awk '{print $3}')
echo "Transfer Hook deployed: $TRANSFER_HOOK_ID"

echo ""
echo "=== Deployment Complete ==="
echo "Policy Registry: $POLICY_REGISTRY_ID"
echo "Verifier:        $VERIFIER_ID"
echo "Transfer Hook:   $TRANSFER_HOOK_ID"
echo ""
echo "Update your .env files with these program IDs."
