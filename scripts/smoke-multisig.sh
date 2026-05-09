#!/usr/bin/env bash
# Multisig endpoint smoke test.
#
# Hits every read endpoint plus 404 / 422 boundaries so an operator can
# verify the policy-service squads route is wired before they paste a
# Squads V4 address into the dashboard. No on-chain transactions; the
# bind / unbind / sync flows still need a wallet signature from the UI.
#
# Usage:
#   bash scripts/smoke-multisig.sh                       # uses sample address
#   MULTISIG=BSAinHGE… OPERATOR=J3Vbra9C… bash scripts/smoke-multisig.sh

set -euo pipefail

POLICY_URL="${POLICY_SERVICE_URL:-http://localhost:3001}"

# Smoke-test sentinel: the Squads V4 program ID itself. Devnet does not
# expose a public Aperture-owned multisig we can hard-code, so we send
# the program account through `lookup` instead. The account exists
# (proves RPC is reachable) but is owned by the BPF Loader, not the
# Squads program — so the route returns 422 with the explicit
# "not owned by Squads V4 program" guard. That single response proves
# the RPC layer + owner check are both wired.
#
# Override `MULTISIG=...` with a real Squads multisig address (devnet or
# mainnet) to drive `lookup` toward a 200 with full member metadata.
MULTISIG="${MULTISIG:-SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf}"
OPERATOR="${OPERATOR:-J3Vbra9CobQQsXjm4Lxyo4owfU2dQYbkY53wL4mshM7E}"
VAULT_INDEX="${VAULT_INDEX:-0}"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
case_n=0
pass=0
fail=0

case_check() {
  local label=$1; shift
  # Accepted statuses can be passed as a pipe-separated list, e.g. "200|404".
  # The lookup test is OK with 404 when the placeholder address has not been
  # initialised on Devnet yet — that still proves the RPC route is wired.
  local expected=$1; shift
  case_n=$((case_n + 1))
  printf "  %2d. %-46s " "$case_n" "$label"
  local code; code=$(curl -s -o /tmp/_squads_smoke.json -w "%{http_code}" "$@")
  if [[ "|$expected|" == *"|$code|"* ]]; then
    printf "\033[32m✓\033[0m  %s\n" "$code"
    pass=$((pass + 1))
  else
    printf "\033[31m✗\033[0m  got %s expected %s\n" "$code" "$expected"
    cat /tmp/_squads_smoke.json | head -c 400
    echo
    fail=$((fail + 1))
  fi
}

bold "Squads multisig smoke against $POLICY_URL"
echo "  multisig=$MULTISIG"
echo "  operator=$OPERATOR"
echo

bold "Read endpoints"
case_check "GET /squads/program (static metadata)" 200 \
  "$POLICY_URL/api/v1/squads/program"
case_check "GET /squads/derive-vault (deterministic PDA)" 200 \
  "$POLICY_URL/api/v1/squads/derive-vault?multisig_address=$MULTISIG&vault_index=$VAULT_INDEX"
case_check "GET /squads/derive-vault (bad base58)" 400 \
  "$POLICY_URL/api/v1/squads/derive-vault?multisig_address=NOT_BASE58_!&vault_index=0"
case_check "GET /squads/lookup (live RPC + owner guard)" "200|422" \
  "$POLICY_URL/api/v1/squads/lookup?multisig_address=$MULTISIG&vault_index=$VAULT_INDEX"
case_check "GET /squads/binding/<unbound> (404 boundary)" 404 \
  "$POLICY_URL/api/v1/squads/binding/aperture-test-not-bound"
case_check "GET /squads/audit/<unbound> (200 + empty list)" 200 \
  "$POLICY_URL/api/v1/squads/audit/aperture-test-not-bound"

bold "Write endpoints (validation only — no on-chain side effects)"
case_check "POST /squads/binding (missing body fields)" 400 \
  -X POST "$POLICY_URL/api/v1/squads/binding" \
  -H "content-type: application/json" -d '{}'
case_check "POST /squads/binding (bad multisig address)" 422 \
  -X POST "$POLICY_URL/api/v1/squads/binding" \
  -H "content-type: application/json" \
  -d '{"operator_id":"smoke","multisig_address":"7xkhe3ay4S5XoMWgWHj4LScvgKJiNoqJSUCrzUFKQwGS","vault_index":0,"actor":"7xkhe3ay4S5XoMWgWHj4LScvgKJiNoqJSUCrzUFKQwGS"}'
case_check "POST /squads/binding/foo/sync (no binding)" 404 \
  -X POST "$POLICY_URL/api/v1/squads/binding/aperture-test-not-bound/sync" \
  -H "content-type: application/json" \
  -d '{"actor":"7xkhe3ay4S5XoMWgWHj4LScvgKJiNoqJSUCrzUFKQwGS"}'
case_check "DELETE /squads/binding/foo (no binding)" 404 \
  -X DELETE "$POLICY_URL/api/v1/squads/binding/aperture-test-not-bound" \
  -H "content-type: application/json" \
  -d '{"actor":"7xkhe3ay4S5XoMWgWHj4LScvgKJiNoqJSUCrzUFKQwGS"}'

bold "Proposals (off-chain mirror)"
case_check "GET /squads/proposals/operator/<unbound> (200 + empty)" 200 \
  "$POLICY_URL/api/v1/squads/proposals/operator/aperture-test-not-bound"
case_check "GET /squads/proposals/policy/<missing> (200 + empty)" 200 \
  "$POLICY_URL/api/v1/squads/proposals/policy/00000000-0000-0000-0000-000000000000"
case_check "GET /squads/proposal/<missing> (404 boundary)" 404 \
  "$POLICY_URL/api/v1/squads/proposal/00000000-0000-0000-0000-000000000000"
case_check "POST /squads/proposal (missing body fields)" 400 \
  -X POST "$POLICY_URL/api/v1/squads/proposal" \
  -H "content-type: application/json" -d '{}'
case_check "PATCH /squads/proposal/<missing>/status (404)" 404 \
  -X PATCH "$POLICY_URL/api/v1/squads/proposal/00000000-0000-0000-0000-000000000000/status" \
  -H "content-type: application/json" -d '{"status":"executed"}'

echo
bold "Result: $pass passed, $fail failed (of $case_n)"
[[ "$fail" == 0 ]]
