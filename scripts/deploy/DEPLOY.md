# Aperture Devnet Deploy — Adım 10

End-to-end devnet deploy çıktıları + komutları. Adım 1-9'daki tüm kod
değişiklikleri tamamlandı; bu kılavuzu çalıştırmak production-ready
binary'leri devnet'e indiriyor.

---

## 0) Pre-flight

```bash
solana config set --url https://api.devnet.solana.com
solana balance     # >= 5 SOL önerilir; 3 program upgrade + ATA + rent için
solana airdrop 5   # devnet için yeterli
```

Wallet `~/.config/solana/id.json` olmalı (Anchor.toml bunu işaret ediyor).
Gerekirse `solana-keygen new -o ~/.config/solana/id.json`.

---

## 1) Build (zaten yapıldı, doğrulama)

Üç `.so` dosyası `target/deploy/` altında hazır:

```bash
ls -la target/deploy/
# verifier.so          (513 KB, includes verify_payment_v2 + verify_mpp_payment_proof + record_payment)
# policy_registry.so   (272 KB)
# transfer_hook.so     (108 KB, includes 5-extra-account layout)
```

Yeniden build etmek istersen:
```bash
anchor build --program-name verifier
anchor build --program-name policy_registry
cd programs/transfer-hook && cargo build-sbf
cp programs/transfer-hook/target/deploy/transfer_hook.so target/deploy/
```

---

## 2) Program upgrade (×3)

Mevcut program ID'leri korunuyor — `upgrade` ile redeploy:

```bash
# Verifier (en büyük değişiklik: 4 yeni instruction + cross-program PolicyAccount)
solana program deploy \
  --upgrade-authority ~/.config/solana/id.json \
  --program-id AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU \
  target/deploy/verifier.so

# Policy registry (state struct değişmedi, sadece rebuild)
solana program deploy \
  --upgrade-authority ~/.config/solana/id.json \
  --program-id FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU \
  target/deploy/policy_registry.so

# Transfer-hook (5-extra-account layout + record_payment CPI)
solana program deploy \
  --upgrade-authority ~/.config/solana/id.json \
  --program-id 3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt \
  target/deploy/transfer_hook.so
```

Buffer overflow / lamports yetersizse: `solana program close <BUFFER_ID>`.

---

## 3) ExtraAccountMetaList re-init (vUSDC için)

Transfer-hook eski 3-extra-account layout ile oluşturulmuş ExtraAccountMetaList
PDA'sını kullanmaz artık. Yeni 5-extra-account layout için PDA'yı kapatıp
yeniden init etmeli.

```bash
# 1. Mevcut PDA'yı kapat (rent geri al)
EXTRA_METAS_PDA=$(solana find-program-derived-address \
  3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt \
  string:extra-account-metas \
  pubkey:$VUSDC_MINT)
solana transfer ... # ya da custom close ix

# 2. Yeni layout ile init
# scripts/init-extra-metas.ts veya manuel transaction
```

> **Not**: Bu adım için bir helper script (`scripts/reinit-extra-metas.ts`)
> Adım 10.b'de yazılacak. Şimdilik manuel close + init.

---

## 4) MPP authority keypair

`scripts/deploy/mpp-authority.json` zaten üretildi.
- Pubkey: `46i1zhvWsXrA2Ny1PWe3gGmRWNNy4RpkYrBuUxe5cfyq` — verifier'da hardcoded
- Secret (base58 64-byte) `.env`'e yazılmalı:

```
MPP_AUTHORITY_KEYPAIR_BASE58=dK6wN76jx18e88Ynnx6yCAEPw52ppqoanTE2KCRpwLiPn7U2fwBZFoDJPWmVfhaVq65724a7GTGZutwkCcsPEX1
```

Production'da bu keypair KMS'te tutulmalı; rotasyon program upgrade gerektirir.

---

## 5) Stripe webhook + customer setup

Geliştirme:
```bash
stripe listen --forward-to localhost:3002/api/v1/mpp/webhook
# çıktıdaki "whsec_..." değerini .env'e yaz:
# STRIPE_WEBHOOK_SECRET=whsec_xxx
```

Customer + saved card (operator manuel, bir kerelik):
```bash
# 1. Stripe Dashboard → Customers → Create
#    Customer ID kaydet → STRIPE_CUSTOMER_ID
# 2. SetupIntent + setup_future_usage ile kart ekle (3D Secure)
#    PaymentMethod ID kaydet → STRIPE_PAYMENT_METHOD_ID
```

---

## 6) `.env` güncelle

```bash
# Stripe
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CUSTOMER_ID=cus_...      # opsiyonel, agent MPP cycle için
STRIPE_PAYMENT_METHOD_ID=pm_... # opsiyonel

# MPP authority
MPP_AUTHORITY_KEYPAIR_BASE58=dK6wN76jx18e88Ynnx6yCAEPw52ppqoanTE2KCRpwLiPn7U2fwBZFoDJPWmVfhaVq65724a7GTGZutwkCcsPEX1
```

---

## 7) Container rebuild + restart

```bash
docker compose build compliance-api agent-service prover-service
docker compose up -d
```

Migration koş:
```bash
npm run migrate
# 005_create_verified_payment_intents (compliance) ve 005-007 (policy)
# zaten uygulandıysa idempotent.
```

---

## 8) E2E doğrulama

### A) Solana flow (x402 → vUSDC + transfer-hook)

1. Dashboard → Policies → Create Policy → Anchor on-chain (wallet imzası)
2. Policy `onchain_status='registered'` olduktan sonra agent başlat:
   ```bash
   curl -X POST http://localhost:3004/start
   ```
3. Solana Explorer'da takip et:
   - `verify_payment_proof_v2` tx — proof anchored
   - `transferCheckedWithTransferHook` tx — hook tetiklendi, `record_payment` CPI
   - OperatorState PDA: `daily_spent_lamports` arttı

### B) MPP flow (Stripe → ed25519 → verify_mpp_payment_proof)

1. `STRIPE_CUSTOMER_ID` + `STRIPE_PAYMENT_METHOD_ID` set ise agent otomatik MPP cycle koşacak.
2. `stripe listen` terminalinde webhook event'leri gözlemle.
3. `/api/v1/compliance/verified-payment/<pi_id>` → poseidon_hash + signature
4. Solana Explorer'da `verify_mpp_payment_proof` tx — ed25519 ix index 0'da

### C) Reject senaryoları

- **Limit aşan amount**: Policy `max_per_transaction=10`, agent 50 göndermeye çalışır → `MaxPerTxExceeded` hatası, transfer reject
- **Blocked recipient**: Policy.blocked_addresses içinde recipient varsa → proof `is_compliant=false`, agent skip
- **Cross-flow attack**: MPP proof Solana flow'da kullanılmaya çalışılırsa → `StripeReceiptUnexpected`
- **Stale daily_spent**: Eski proof'la günde tekrar ödeme → `DailySpentMismatch`
- **Yanlış mint**: vUSDC dışı bir mint ile transfer → transfer-hook `MintMismatch`

---

## 9) Rollback

Eski binary'lere dönmek için:
```bash
solana program write-buffer target/deploy/verifier.so   # yeni buffer
# Sonra önceki commit'in .so'u ile aynı şey:
git checkout <prev-commit> -- target/deploy/
solana program deploy --upgrade-authority ... --program-id <id> target/deploy/<old>.so
```

---

## Artifacts

- **MPP authority keypair**: `scripts/deploy/mpp-authority.json` (gitignore'da)
- **Built .so**: `target/deploy/{verifier,policy_registry,transfer_hook}.so`
- **VK Rust source**: `programs/verifier/src/groth16_vk.rs` (PAYMENT_NR_INPUTS=10)
- **Circuit zkey + wasm**: `services/prover-service/artifacts/`
