'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Shield,
  Plus,
  Trash2,
  Edit3,
  X,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { policyApi, type Policy, type PolicyInput } from '@/lib/api';
import { config } from '@/lib/config';
import { formatDate, formatAmount } from '@/lib/utils';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useApertureWalletModal } from '@/components/shared/WalletModal';
import {
  buildInitializeOperatorIx,
  buildRegisterPolicyIx,
  buildUpdatePolicyIx,
  deriveOperatorPDA,
} from '@/lib/anchor-instructions';
import {
  ApInput,
  ApCheckbox,
  ApFieldset,
} from './policies/ApField';

// Mint addresses come from runtime config so a deploy that re-issues any of
// these (or rebrands aUSDC again) does not require a code change.
const AUSDC_MINT = config.tokens.aUSDC;
const USDC_MINT = config.tokens.usdc;
const USDT_MINT = config.tokens.usdt;

interface PolicyFormData {
  readonly name: string;
  readonly description: string;
  readonly max_daily_spend: string;
  readonly max_per_transaction: string;
  readonly allowed_endpoint_categories: string;
  readonly blocked_addresses: string;
  readonly ausdc_enabled: boolean;
  readonly usdc_enabled: boolean;
  readonly usdt_enabled: boolean;
  readonly time_restriction_days: string;
  readonly time_restriction_start: string;
  readonly time_restriction_end: string;
  readonly time_restriction_timezone: string;
}

const INITIAL_FORM_DATA: PolicyFormData = {
  name: '',
  description: '',
  max_daily_spend: '',
  max_per_transaction: '',
  allowed_endpoint_categories: '',
  blocked_addresses: '',
  // aUSDC defaults to true because it is the only mint whose Token-2022
  // transfer hook can enforce the policy on-chain. Plain USDC and USDT have
  // no hook so a policy whitelisting them lets the agent bypass enforcement.
  ausdc_enabled: true,
  usdc_enabled: false,
  usdt_enabled: false,
  time_restriction_days: '',
  time_restriction_start: '',
  time_restriction_end: '',
  time_restriction_timezone: 'UTC',
};


export function PoliciesTab() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible: openWalletModal } = useApertureWalletModal();
  const operatorId = useOperatorId();

  const [policies, setPolicies] = useState<readonly Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PolicyFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);
  const [anchoringId, setAnchoringId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    if (!operatorId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await policyApi.list(operatorId);
      setPolicies(response.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch policies';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  function updateFormField<K extends keyof PolicyFormData>(
    field: K,
    value: PolicyFormData[K]
  ): void {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function handleEdit(policy: Policy): void {
    setEditingId(policy.id);
    setFormData({
      name: policy.name,
      description: policy.description ?? '',
      max_daily_spend: String(policy.max_daily_spend),
      max_per_transaction: String(policy.max_per_transaction),
      allowed_endpoint_categories: policy.allowed_endpoint_categories.join(', '),
      blocked_addresses: policy.blocked_addresses.join(', '),
      ausdc_enabled: AUSDC_MINT
        ? policy.token_whitelist.includes(AUSDC_MINT)
        : false,
      usdc_enabled: USDC_MINT
        ? policy.token_whitelist.includes(USDC_MINT)
        : false,
      usdt_enabled: USDT_MINT
        ? policy.token_whitelist.includes(USDT_MINT)
        : false,
      time_restriction_days:
        policy.time_restrictions.length > 0
          ? policy.time_restrictions[0].allowed_days.join(', ')
          : '',
      time_restriction_start:
        policy.time_restrictions.length > 0
          ? String(policy.time_restrictions[0].allowed_hours_start)
          : '',
      time_restriction_end:
        policy.time_restrictions.length > 0
          ? String(policy.time_restrictions[0].allowed_hours_end)
          : '',
      time_restriction_timezone:
        policy.time_restrictions.length > 0
          ? policy.time_restrictions[0].timezone
          : 'UTC',
    });
    setShowForm(true);
  }

  function resetForm(): void {
    setFormData(INITIAL_FORM_DATA);
    setEditingId(null);
    setShowForm(false);
  }

  function buildTokenWhitelist(data: PolicyFormData): string[] {
    const tokens: string[] = [];
    if (data.ausdc_enabled && AUSDC_MINT) tokens.push(AUSDC_MINT);
    if (data.usdc_enabled && USDC_MINT) tokens.push(USDC_MINT);
    if (data.usdt_enabled && USDT_MINT) tokens.push(USDT_MINT);
    return tokens;
  }

  function buildPolicyInput(data: PolicyFormData, opId: string): PolicyInput {
    const DAY_ALIASES: Record<string, string> = {
      mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday',
      fri: 'friday', sat: 'saturday', sun: 'sunday',
    };

    const timeRestrictions =
      data.time_restriction_days.trim() !== ''
        ? [
            {
              allowed_days: data.time_restriction_days
                .split(',')
                .map((d) => {
                  const lower = d.trim().toLowerCase();
                  return DAY_ALIASES[lower] ?? lower;
                })
                .filter(Boolean),
              allowed_hours_start: Number(data.time_restriction_start) || 0,
              allowed_hours_end: Number(data.time_restriction_end) || 23,
              timezone: data.time_restriction_timezone || 'UTC',
            },
          ]
        : [];

    const categories = data.allowed_endpoint_categories
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    return {
      operator_id: opId,
      name: data.name.trim(),
      description: data.description.trim() || undefined,
      max_daily_spend: Number(data.max_daily_spend),
      max_per_transaction: Number(data.max_per_transaction),
      allowed_endpoint_categories: categories.length > 0 ? categories : ['general'],
      blocked_addresses: data.blocked_addresses
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      time_restrictions: timeRestrictions,
      token_whitelist: buildTokenWhitelist(data),
    };
  }

  /**
   * Pulls the canonical on-chain payload from policy-service, signs the
   * register_policy or update_policy instruction with the connected wallet,
   * and reports the outcome back to the server. Either side ends in a
   * deterministic on-chain status — never the silent "saved to DB but maybe
   * also on-chain" half-state the previous flow allowed.
   *
   * Throws on any failure; the caller decides how to surface to the user.
   * On a thrown error, the policy row in the DB is already flipped to
   * onchain_status='failed' with the error message attached.
   */
  async function anchorPolicy(policy: Policy): Promise<{ tx_signature: string; onchain_pda: string }> {
    if (!publicKey || !sendTransaction) {
      throw new Error('Wallet not connected');
    }

    const payloadRes = await policyApi.getOnchainPayload(policy.id);
    const payload = payloadRes.data;
    if (!payload) {
      throw new Error('Policy onchain payload missing');
    }
    if (payload.operation === 'noop') {
      // Already registered on-chain with the current commitment — surface the
      // existing tx so the caller can short-circuit.
      return {
        tx_signature: policy.onchain_tx_signature ?? '',
        onchain_pda: payload.onchain_pda ?? '',
      };
    }

    const tx = new Transaction();

    const [operatorPDA] = deriveOperatorPDA(publicKey);
    const operatorInfo = await connection.getAccountInfo(operatorPDA);
    if (!operatorInfo) {
      tx.add(
        buildInitializeOperatorIx(publicKey, publicKey.toBase58().slice(0, 32)),
      );
    }

    let policyPDABase58: string;
    let nextOnchainVersion: number;

    if (payload.operation === 'register') {
      const { instruction, policyPDA } = buildRegisterPolicyIx(
        publicKey,
        payload.policy_id_bytes_hex,
        payload.merkle_root_hex,
        payload.policy_data_hash_hex,
      );
      tx.add(instruction);
      policyPDABase58 = policyPDA.toBase58();
      nextOnchainVersion = 1;
    } else {
      // 'update' — the on-chain program bumps PolicyAccount.version atomically;
      // we mirror that so the DB row converges on the new value.
      if (!payload.onchain_pda) {
        throw new Error('Update operation but onchain_pda missing in payload');
      }
      const policyPDA = new PublicKey(payload.onchain_pda);
      tx.add(
        buildUpdatePolicyIx(
          publicKey,
          operatorPDA,
          policyPDA,
          payload.merkle_root_hex,
          payload.policy_data_hash_hex,
        ),
      );
      policyPDABase58 = payload.onchain_pda;
      nextOnchainVersion = (payload.onchain_version ?? 1) + 1;
    }

    tx.feePayer = publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    // Pre-flight simulate so we surface the on-chain failure mode
    // (account already in use, insufficient SOL, malformed Borsh, etc.)
    // instead of the wallet adapter's opaque "Transaction failed" wrapper.
    let sig: string;
    try {
      console.log('[anchor] simulating tx with', tx.instructions.length, 'instruction(s) for policy', policy.id);
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        const logs = sim.value.logs?.join('\n') ?? '';
        throw new Error(
          `On-chain simulation failed: ${JSON.stringify(sim.value.err)}` +
          (logs ? `\n\nProgram logs:\n${logs}` : ''),
        );
      }
      console.log('[anchor] simulation OK, sending tx...');
      sig = await sendTransaction(tx, connection);
      console.log('[anchor] tx sent, signature:', sig);
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('[anchor] tx confirmed');
    } catch (sendErr) {
      const message =
        sendErr instanceof Error ? sendErr.message : 'Transaction failed';
      console.error('[anchor] failed:', message, sendErr);
      // Best-effort failure flag; do not let a failure-of-failure report
      // mask the original cause.
      try {
        await policyApi.confirmOnchain(policy.id, {
          status: 'failed',
          error_message: message,
        });
      } catch {
        /* noop — original error is what we surface */
      }
      throw sendErr;
    }

    await policyApi.confirmOnchain(policy.id, {
      status: 'registered',
      tx_signature: sig,
      onchain_pda: policyPDABase58,
      onchain_version: nextOnchainVersion,
      merkle_root_hex: payload.merkle_root_hex,
      policy_data_hash_hex: payload.policy_data_hash_hex,
    });

    return { tx_signature: sig, onchain_pda: policyPDABase58 };
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!operatorId) return;

    if (!publicKey) {
      setError('Connect your wallet first — every policy must be anchored on Solana.');
      openWalletModal(true);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const input = buildPolicyInput(formData, operatorId);
      let savedPolicy: Policy;
      if (editingId) {
        const res = await policyApi.update(editingId, input);
        savedPolicy = res.data!;
      } else {
        const res = await policyApi.create(input);
        savedPolicy = res.data!;
      }

      try {
        await anchorPolicy(savedPolicy);
      } catch (chainErr) {
        const reason =
          chainErr instanceof Error ? chainErr.message : 'Transaction error';
        setError(
          `Policy saved off-chain but on-chain anchoring failed: ${reason}. Use the "Anchor on-chain" button on the policy card to retry.`,
        );
      }

      resetForm();
      await fetchPolicies();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save policy';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Re-attempts on-chain anchoring for a policy that is currently in
   * 'pending' or 'failed' state. Used by the "Anchor on-chain" button on
   * each policy card.
   */
  async function handleAnchor(policy: Policy): Promise<void> {
    if (!publicKey) {
      setError('Connect your wallet first.');
      openWalletModal(true);
      return;
    }
    setError(null);
    setAnchoringId(policy.id);
    try {
      await anchorPolicy(policy);
      await fetchPolicies();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Transaction error';
      setError(`On-chain anchoring failed: ${reason}`);
      // Refresh anyway so the failure status badge shows up immediately.
      await fetchPolicies();
    } finally {
      setAnchoringId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);
    try {
      await policyApi.delete(id);
      setDeleteConfirm(null);
      await fetchPolicies();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete policy';
      setError(message);
    }
  }

  if (!operatorId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
        <Shield className="w-12 h-12 mb-4" />
        <p className="text-lg">Connect your wallet to view policies</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-[32px] sm:text-[40px] leading-[1.05] tracking-[-0.012em] text-black">
            Policies
          </h2>
          <p className="text-[14px] text-black/55 tracking-tighter mt-1">
            Compliance rules enforced atomically inside the verifier program
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="ap-btn-orange inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Policy
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="ap-card p-4 flex items-center gap-3" style={{ borderColor: '#fca5a5' }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-600" />
          <p className="text-[14px] text-red-700 tracking-tighter">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-black/45 hover:text-black"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <div className="ap-card p-6 sm:p-7">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-display text-[22px] tracking-[-0.005em] text-black">
                {editingId ? 'Edit Policy' : 'Create New Policy'}
              </h3>
              <p className="text-[12px] text-black/55 tracking-tighter mt-1">
                Saved as a Poseidon-hashed Merkle root and anchored on Solana via the
                Policy Registry program.
              </p>
            </div>
            <button
              onClick={resetForm}
              className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/55 hover:bg-black/5 hover:text-black transition-colors"
              aria-label="Close form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-7">
            <ApFieldset
              title="Policy Identity"
              description="Names and short descriptions only — no PII. The on-chain commitment hashes only the rule values, not these labels."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ApInput
                  label="Policy Name"
                  required
                  value={formData.name}
                  onChange={(e) => updateFormField('name', e.target.value)}
                  placeholder="e.g. Standard Compliance"
                />
                <ApInput
                  label="Description"
                  value={formData.description}
                  onChange={(e) => updateFormField('description', e.target.value)}
                  placeholder="Optional description"
                />
              </div>
            </ApFieldset>

            <ApFieldset
              title="Spend Limits"
              description="Caps enforced atomically inside verify_payment_proof_v2_with_transfer. Daily totals reset on Solana clock midnight UTC."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ApInput
                  label="Max Daily Spend"
                  required
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.max_daily_spend}
                  onChange={(e) => updateFormField('max_daily_spend', e.target.value)}
                  placeholder="10000"
                  trailingAdornment="USD"
                />
                <ApInput
                  label="Max Per Transaction"
                  required
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.max_per_transaction}
                  onChange={(e) => updateFormField('max_per_transaction', e.target.value)}
                  placeholder="5000"
                  trailingAdornment="USD"
                />
              </div>
            </ApFieldset>

            <ApFieldset
              title="Allow / Block Lists"
              description="Categories gate which paywalled endpoints the agent can pay; blocked addresses are rejected before the proof is even built."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ApInput
                  label="Allowed Endpoint Categories"
                  value={formData.allowed_endpoint_categories}
                  onChange={(e) =>
                    updateFormField('allowed_endpoint_categories', e.target.value)
                  }
                  placeholder="payroll, vendor, treasury"
                  helper="Comma-separated. The agent loop requires x402 + mpp here to start."
                />
                <ApInput
                  label="Blocked Addresses"
                  value={formData.blocked_addresses}
                  onChange={(e) => updateFormField('blocked_addresses', e.target.value)}
                  placeholder="Address1, Address2"
                  helper="Comma-separated. Hashed into the Merkle leaf, not stored in the clear on-chain."
                />
              </div>
            </ApFieldset>

            <ApFieldset
              title="Token Whitelist"
              description="The verifier rejects any transfer whose mint isn't whitelisted. aUSDC additionally enforces the Token-2022 transfer hook."
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {USDC_MINT && (
                  <ApCheckbox
                    label="USDC"
                    description="SPL Token v1 · standard Devnet mint"
                    checked={formData.usdc_enabled}
                    onChange={(e) => updateFormField('usdc_enabled', e.target.checked)}
                  />
                )}
                {USDT_MINT && (
                  <ApCheckbox
                    label="USDT"
                    description="SPL Token v1 · Aperture Devnet"
                    checked={formData.usdt_enabled}
                    onChange={(e) => updateFormField('usdt_enabled', e.target.checked)}
                  />
                )}
                {AUSDC_MINT && (
                  <ApCheckbox
                    label="aUSDC"
                    description="Token-2022 · legacy compliance hook"
                    checked={formData.ausdc_enabled}
                    onChange={(e) => updateFormField('ausdc_enabled', e.target.checked)}
                  />
                )}
              </div>
            </ApFieldset>

            <ApFieldset
              title="Time Restrictions"
              description="Optional. Compared against Solana's Clock sysvar at proof-verification time."
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <ApInput
                  label="Allowed Days"
                  value={formData.time_restriction_days}
                  onChange={(e) =>
                    updateFormField('time_restriction_days', e.target.value)
                  }
                  placeholder="Mon, Tue, Wed…"
                />
                <ApInput
                  label="Start Hour"
                  type="number"
                  min={0}
                  max={23}
                  value={formData.time_restriction_start}
                  onChange={(e) =>
                    updateFormField('time_restriction_start', e.target.value)
                  }
                  placeholder="9"
                  trailingAdornment="0–23"
                />
                <ApInput
                  label="End Hour"
                  type="number"
                  min={0}
                  max={23}
                  value={formData.time_restriction_end}
                  onChange={(e) =>
                    updateFormField('time_restriction_end', e.target.value)
                  }
                  placeholder="17"
                  trailingAdornment="0–23"
                />
                <ApInput
                  label="Timezone"
                  value={formData.time_restriction_timezone}
                  onChange={(e) =>
                    updateFormField('time_restriction_timezone', e.target.value)
                  }
                  placeholder="UTC"
                />
              </div>
            </ApFieldset>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2 border-t border-black/8">
              <button
                type="button"
                onClick={resetForm}
                className="ap-btn-ghost-light"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Update Policy' : 'Create Policy'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="ap-card p-12 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-aperture animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && policies.length === 0 && !error && (
        <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
            <Shield className="w-6 h-6" />
          </span>
          <h3 className="font-display text-[22px] tracking-[-0.005em] text-black">
            No policies yet
          </h3>
          <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
            Create your first compliance policy to define spending limits and allowed
            tokens. Aperture enforces every rule on-chain via Groth16 proofs.
          </p>
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="ap-btn-orange inline-flex items-center gap-2 mt-2"
          >
            <Plus className="w-4 h-4" />
            Create your first policy
          </button>
        </div>
      )}

      {/* Policy cards */}
      {!loading && policies.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {policies.map((policy) => (
            <div key={policy.id} className="ap-card p-5 sm:p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-display text-[20px] tracking-[-0.005em] text-black truncate">
                      {policy.name}
                    </h3>
                    {policy.is_active ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-aperture/15 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-aperture-dark">
                        <CheckCircle className="w-3 h-3" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-red-500/12 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-red-700">
                        <XCircle className="w-3 h-3" />
                        Inactive
                      </span>
                    )}
                  </div>
                  {policy.description && (
                    <p className="text-[13px] text-black/55 tracking-tighter truncate">
                      {policy.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleEdit(policy)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/55 hover:text-aperture-dark hover:bg-aperture/10 transition-colors"
                    aria-label={`Edit ${policy.name}`}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {deleteConfirm === policy.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(policy.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-red-600 hover:bg-red-500/10 transition-colors"
                        aria-label="Confirm delete"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/55 hover:bg-black/5 hover:text-black transition-colors"
                        aria-label="Cancel delete"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(policy.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/55 hover:text-red-600 hover:bg-red-500/10 transition-colors"
                      aria-label={`Delete ${policy.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
                    Max Daily Spend
                  </div>
                  <div className="text-[14px] font-medium text-black tracking-tighter mt-0.5 font-mono">
                    {formatAmount(policy.max_daily_spend)}
                  </div>
                </div>
                <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
                    Max Per Tx
                  </div>
                  <div className="text-[14px] font-medium text-black tracking-tighter mt-0.5 font-mono">
                    {formatAmount(policy.max_per_transaction)}
                  </div>
                </div>
                <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
                    Version
                  </div>
                  <div className="text-[14px] font-medium text-black tracking-tighter mt-0.5">
                    v{policy.version}
                  </div>
                </div>
                <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
                    Created
                  </div>
                  <div className="text-[14px] font-medium text-black tracking-tighter mt-0.5">
                    {formatDate(policy.created_at)}
                  </div>
                </div>
              </dl>

              {policy.token_whitelist.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.08em] text-black/55 mr-1">
                    Tokens
                  </span>
                  {policy.token_whitelist.map((mint) => (
                    <span
                      key={mint}
                      className="inline-flex items-center rounded-pill bg-aperture/10 px-2 py-0.5 text-[11px] font-mono text-aperture-dark"
                    >
                      {mint === AUSDC_MINT
                        ? 'aUSDC'
                        : mint === USDC_MINT
                          ? 'USDC'
                          : mint === USDT_MINT
                            ? 'USDT'
                            : mint.slice(0, 8)}
                    </span>
                  ))}
                </div>
              )}

              {/* On-chain anchoring status */}
              <div className="pt-3 border-t border-black/8">
                {policy.onchain_status === 'registered' ? (
                  <div className="flex flex-wrap items-center gap-3 text-[12px] tracking-tighter">
                    <span className="inline-flex items-center gap-1 rounded-pill bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-700">
                      <CheckCircle className="w-3 h-3" />
                      Anchored on Solana
                      {policy.onchain_version !== null
                        ? ` (v${policy.onchain_version})`
                        : ''}
                    </span>
                    {policy.onchain_tx_signature && (
                      <a
                        href={config.txExplorerUrl(policy.onchain_tx_signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-aperture-dark hover:text-black transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View tx
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                          policy.onchain_status === 'failed'
                            ? 'bg-red-500/12 text-red-700'
                            : 'bg-aperture/15 text-aperture-dark'
                        }`}
                      >
                        {policy.onchain_status === 'failed' ? (
                          <XCircle className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        {policy.onchain_status === 'failed'
                          ? 'On-chain anchoring failed'
                          : policy.onchain_pda
                            ? 'Off-chain edits pending — re-anchor'
                            : 'Not yet anchored on Solana'}
                      </span>
                      <button
                        onClick={() => handleAnchor(policy)}
                        disabled={anchoringId === policy.id || !publicKey}
                        className="ap-btn-orange inline-flex items-center gap-1.5 px-3 h-8 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {anchoringId === policy.id && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                        {policy.onchain_pda ? 'Re-anchor' : 'Anchor on-chain'}
                      </button>
                    </div>
                    {policy.onchain_status === 'failed' &&
                      policy.onchain_last_error && (
                        <p className="text-[11px] text-red-700/85 font-mono break-all">
                          {policy.onchain_last_error}
                        </p>
                      )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
