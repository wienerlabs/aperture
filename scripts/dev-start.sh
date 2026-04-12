#!/bin/bash
# Start all Aperture services for local development
# Usage: ./scripts/dev-start.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Load .env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "=== Stopping existing services ==="
kill -9 $(lsof -ti :3000) 2>/dev/null || true
kill -9 $(lsof -ti :3001) 2>/dev/null || true
kill -9 $(lsof -ti :3002) 2>/dev/null || true
kill -9 $(lsof -ti :3003) 2>/dev/null || true
kill -9 $(lsof -ti :3004) 2>/dev/null || true
sleep 1

echo "=== Starting PostgreSQL (Docker) ==="
docker compose up -d postgres-policy postgres-compliance
sleep 3

echo "=== Starting Policy Service (port 3001) ==="
POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 \
POSTGRES_USER="${POSTGRES_USER:-aperture}" \
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-aperture_dev_password}" \
POSTGRES_DB="${POSTGRES_DB_POLICY:-aperture_policy}" \
nohup npx tsx services/policy-service/src/index.ts > /tmp/aperture-policy.log 2>&1 &
echo "  PID: $!"

echo "=== Starting Compliance API (port 3002) ==="
POSTGRES_HOST=localhost \
POSTGRES_PORT=5433 \
POSTGRES_USER="${POSTGRES_USER:-aperture}" \
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-aperture_dev_password}" \
POSTGRES_DB="${POSTGRES_DB_COMPLIANCE:-aperture_compliance}" \
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY}" \
STRIPE_API_VERSION="${STRIPE_API_VERSION:-2026-03-04.preview}" \
MPP_SECRET_KEY="${MPP_SECRET_KEY}" \
nohup npx tsx services/compliance-api/src/index.ts > /tmp/aperture-compliance.log 2>&1 &
echo "  PID: $!"

echo "=== Starting Prover Service (port 3003) ==="
PROVER_SERVICE_PORT=3003 \
RUST_LOG=info \
nohup "$ROOT_DIR/services/prover-service/target/release/aperture-prover-service" > /tmp/aperture-prover.log 2>&1 &
echo "  PID: $!"

echo "=== Starting Agent Service (port 3004) ==="
AGENT_SERVICE_PORT=3004 \
AGENT_WALLET_PRIVATE_KEY="${AGENT_WALLET_PRIVATE_KEY}" \
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}" \
POLICY_SERVICE_URL="http://localhost:3001" \
COMPLIANCE_API_URL="http://localhost:3002" \
PROVER_SERVICE_URL="http://localhost:3003" \
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY}" \
USDC_MINT="${USDC_MINT:-4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU}" \
AGENT_INTERVAL_MS="${AGENT_INTERVAL_MS:-30000}" \
nohup npx tsx services/agent-service/src/index.ts > /tmp/aperture-agent.log 2>&1 &
echo "  PID: $!"

echo "=== Starting Dashboard (port 3000) ==="
cd "$ROOT_DIR/dashboard"
nohup npx next dev -p 3000 > /tmp/aperture-frontend.log 2>&1 &
echo "  PID: $!"
cd "$ROOT_DIR"

echo ""
echo "Waiting for services..."
sleep 5

echo ""
echo "=== Health Checks ==="
curl -s -o /dev/null -w "Frontend  (3000): %{http_code}\n" http://localhost:3000
curl -s http://localhost:3001/health | grep -q '"healthy"' && echo "Policy    (3001): OK" || echo "Policy    (3001): FAIL"
curl -s http://localhost:3002/health | grep -q '"healthy"' && echo "Compliance(3002): OK" || echo "Compliance(3002): FAIL"
curl -s http://localhost:3003/health | grep -q '"healthy"' && echo "Prover    (3003): OK" || echo "Prover    (3003): FAIL"
curl -s http://localhost:3004/health | grep -q '"healthy"' && echo "Agent     (3004): OK" || echo "Agent     (3004): FAIL"
echo ""
echo "Dashboard: http://localhost:3000"
