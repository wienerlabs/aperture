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

# Sample multisig address from a known Squads V4 deployment. The lookup
# call expects the account to either exist (returns metadata) or to fail
# with 422 ("not owned by Squads V4 program") — both prove the route is
# wired correctly.
MULTISIG="${MULTISIG:-BSAinHGEsuZWRYC3UfbMwELeHqZQ8VgWiKsspGbW1zh4}"
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
case_check "GET /squads/lookup (live RPC)" "200|404" \
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

echo
bold "Result: $pass passed, $fail failed (of $case_n)"
[[ "$fail" == 0 ]]
