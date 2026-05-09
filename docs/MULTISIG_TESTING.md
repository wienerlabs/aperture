# Multisig Testing Guide

Aperture's Squads V4 multisig binding has three layers worth testing end
to end:

1. **Backend HTTP** — `policy-service` `squads.ts` routes
2. **On-chain** — `set_multisig` Anchor instruction in the Policy Registry
3. **Dashboard UI** — the Multisig tab + Settings summary card

This guide walks an operator through testing all three with the smallest
amount of plumbing. Section [3](#3-end-to-end-on-devnet) is the canonical
"does it actually work" smoke; everything else is for diagnosing failures.

---

## 1. Backend smoke (no wallet needed)

Run while `policy-service` is up on port 3001.

```bash
bash scripts/smoke-multisig.sh
```

Expected output:

```
  1. GET /squads/program (static metadata)          ✓  200
  2. GET /squads/derive-vault (deterministic PDA)   ✓  200
  3. GET /squads/derive-vault (bad base58)          ✓  400
  4. GET /squads/lookup (live RPC)                  ✓  200|404
  5. GET /squads/binding/<unbound> (404 boundary)   ✓  404
  6. GET /squads/audit/<unbound> (200 + empty list) ✓  200
  7. POST /squads/binding (missing body fields)     ✓  400
  8. POST /squads/binding (bad multisig address)    ✓  422
  9. POST /squads/binding/foo/sync (no binding)     ✓  404
 10. DELETE /squads/binding/foo (no binding)        ✓  404
```

`#4` is allowed to be 404 if the placeholder address is not a deployed
multisig on the cluster the policy-service points at. It still proves the
RPC code path is wired. Override the placeholder with your own multisig
to force a 200:

```bash
MULTISIG=YourSquadsAddressHere bash scripts/smoke-multisig.sh
```

---

## 2. Direct API smoke (manual)

Useful when you have an existing Squads V4 multisig you want to inspect
before binding it to your operator. None of these calls touch the chain
beyond a single read.

```bash
# 2a. Verify the program ID the dashboard pins client-side matches the
# program ID the policy-service uses. If these diverge, the vault PDA
# mismatch guard inside MultisigBindingCard will fire.
curl -s http://localhost:3001/api/v1/squads/program | jq

# 2b. Preview the deterministic vault PDA for any multisig + vault index.
# Should match the value MultisigBindingCard derives client-side.
curl -s "http://localhost:3001/api/v1/squads/derive-vault?multisig_address=YOUR_MS&vault_index=0" | jq

# 2c. Read the multisig from chain. Returns threshold, members, vault PDA.
# 422 if the account exists but isn't owned by Squads V4. 404 if the
# account doesn't exist at all on the configured cluster.
curl -s "http://localhost:3001/api/v1/squads/lookup?multisig_address=YOUR_MS&vault_index=0" | jq

# 2d. Audit log — every bind / sync / unbind for an operator.
curl -s "http://localhost:3001/api/v1/squads/audit/YOUR_OPERATOR_ID" | jq
```

---

## 3. End-to-end on Devnet

This is the path a real operator follows. You need:

- A Solana wallet with a few SOL on Devnet (Phantom or Solflare in Devnet
  mode). [Devnet faucet](https://faucet.solana.com).
- A Squads V4 multisig, freshly created at
  [app.squads.so](https://app.squads.so/) (set the network to **Devnet**
  in the wallet adapter when you create it).

### 3.1 Create the multisig in Squads

1. Open https://app.squads.so/ with your wallet on Devnet
2. Click **Create new** → choose **Multisig**
3. Add the members you want; pick a threshold (1/N is fine for testing)
4. Confirm — Squads sends one transaction; the multisig PDA shows up on
   the squads.so explorer
5. Copy the multisig address (the long base58 string under the name)

### 3.2 Bind it via the dashboard

1. `npm run dev` in `dashboard/`, open http://localhost:3000/dashboard
2. Sign in with the same wallet that is a member of the multisig
3. Click the **Multisig** tab in the sidebar
4. Paste the multisig address into the **Squads multisig address** field
5. Pick the same vault index you want to use (`0` is fine if you only
   created one vault)
6. Click **Look up** — you should see the threshold, members, and a vault
   PDA preview. The "You" badge should show on your member entry
7. Optionally fill in a **Label** so it's easy to spot in audit
8. Click **Bind on-chain** — the wallet pops up to sign the
   `set_multisig` instruction
9. After confirmation, the page swaps to **Active Binding** with the
   threshold, members, vault PDA, and an "Open in Squads" link

### 3.3 Verify on the chain

```bash
# Replace with your operator wallet
operator=YOUR_WALLET_PUBKEY

# Operator PDA derivation (same seeds the program uses)
node -e "
const { PublicKey } = require('@solana/web3.js');
const PROGRAM = new PublicKey('FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU');
const [pda] = PublicKey.findProgramAddressSync(
  [Buffer.from('operator'), new PublicKey('${operator}').toBuffer()],
  PROGRAM,
);
console.log(pda.toBase58());
"
```

Take that PDA and look it up:

```bash
solana account <operator_pda> --url devnet --output json | jq '.account.data'
```

Decode the bytes — `OperatorAccount.multisig` is an `Option<Pubkey>`. If
the binding succeeded, it should now be `Some(<vault_pda>)`. The vault PDA
should match what the dashboard showed you.

### 3.4 Sync round-trip

Back in the dashboard:

1. Click **Sync from Solana** in the Active Binding card
2. The audit timeline at the bottom of the Multisig tab should grow by
   one `sync` row pointing at your wallet as the actor

### 3.5 Unbind round-trip

1. Click **Remove binding** → **Confirm**
2. The page swaps back to the binding form
3. The audit log gets an `unbind` row
4. **Note:** the on-chain `OperatorAccount.multisig` field still holds
   the previous vault PDA — only the off-chain cache was cleared. To
   genuinely rotate, bind a different multisig on top.

---

## 4. UI rendering checks (no wallet)

These are sanity checks the build / SSR is healthy. You can run them with
nothing more than `npm run dev`:

| Path | Expected |
|---|---|
| `GET /` | 200, hero renders |
| `GET /dashboard` | 200, sidebar shows the **Multisig** tab |
| Click **Multisig** | hero "Bind a Squads multisig", binding card |
| Switch to **Settings** → **Squads Multisig** | summary + "Bind a multisig" CTA navigates to the Multisig tab |
| Switch to **Overview** | hero ribbon shows "Single signer" pill (clickable, goes to Multisig) |

---

## 5. Common failure modes

### "Multisig account not found on Solana"

The address you pasted isn't a Squads V4 account on the cluster
`policy-service` is using (`SOLANA_RPC_URL` env). Either:

- Wrong cluster (mainnet vs devnet) — set the wallet adapter cluster to
  match
- The multisig hasn't been created yet — finish step 3.1 first
- Typo in the address — re-copy from squads.so

### "Vault PDA mismatch"

The dashboard re-derives the vault PDA client-side from the multisig
address you pasted; if that doesn't equal what the policy-service
returned, the bind is aborted. This usually means the vault index in the
form doesn't match what you previewed. Refresh the lookup and try again.

### Lookup returns 422 "not owned by Squads V4 program"

The address points at an account that exists but isn't a Squads multisig.
Probably an old V3 Squads address (program ID changed in V4) or a
non-Squads account. Use a V4 multisig.

### Audit log empty after bind

The bind succeeded on-chain but the cache call failed (network blip).
Check `policy-service` logs; you can replay by clicking **Bind on-chain**
again — the upsert is idempotent on `operator_id`.
