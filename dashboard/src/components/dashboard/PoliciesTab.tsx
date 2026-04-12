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
import { Transaction } from '@solana/web3.js';
import { useApertureWalletModal } from '@/components/shared/WalletModal';
import {
  buildInitializeOperatorIx,
  buildRegisterPolicyIx,
  deriveOperatorPDA,
} from '@/lib/anchor-instructions';

const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDT_MINT = 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUQS7QEkCybt4rCxsT';

interface PolicyFormData {
  readonly name: string;
  readonly description: string;
  readonly max_daily_spend: string;
  readonly max_per_transaction: string;
  readonly allowed_endpoint_categories: string;
  readonly blocked_addresses: string;
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
  usdc_enabled: true,
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
  const [chainTxMap, setChainTxMap] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PolicyFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);
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
      usdc_enabled: policy.token_whitelist.includes(USDC_MINT),
      usdt_enabled: policy.token_whitelist.includes(USDT_MINT),
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
    if (data.usdc_enabled) tokens.push(USDC_MINT);
    if (data.usdt_enabled) tokens.push(USDT_MINT);
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

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!operatorId) return;

    // Check wallet BEFORE creating policy to prevent duplicates
    if (!publicKey) {
      setError('Connect your wallet first to register policies on-chain.');
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

      // Try on-chain registration (optional — policy is already saved to DB)
      if (publicKey && sendTransaction && savedPolicy) {
        try {
          const compiledRes = await policyApi.compile(savedPolicy.id);
          const compiledJson = JSON.stringify(compiledRes.data);

          const tx = new Transaction();

          const [operatorPDA] = deriveOperatorPDA(publicKey);
          const operatorInfo = await connection.getAccountInfo(operatorPDA);
          if (!operatorInfo) {
            tx.add(buildInitializeOperatorIx(publicKey, publicKey.toBase58().slice(0, 32)));
          }

          const { instruction: registerIx } = await buildRegisterPolicyIx(
            publicKey,
            savedPolicy.id,
            compiledJson
          );
          tx.add(registerIx);

          tx.feePayer = publicKey;
          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;

          const sig = await sendTransaction(tx, connection);
          await connection.confirmTransaction(sig, 'confirmed');
          setChainTxMap(prev => ({ ...prev, [savedPolicy.id]: sig }));
        } catch (chainErr) {
          console.warn('On-chain registration failed (policy saved to DB):', chainErr);
          setError(`Policy saved successfully. On-chain registration failed: ${chainErr instanceof Error ? chainErr.message : 'Transaction error'}. You can retry later.`);
        }
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-amber-100">Policies</h2>
          <p className="text-amber-100/40 text-sm mt-1">
            Manage compliance policies for your payment operations
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg px-6 py-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Policy
        </button>
      </div>

      {/* Error */}

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-amber-100">
              {editingId ? 'Edit Policy' : 'Create New Policy'}
            </h3>
            <button
              onClick={resetForm}
              className="text-amber-100/40 hover:text-amber-100"
              aria-label="Close form"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Name */}
              <div>
                <label className="block text-sm text-amber-100/60 mb-1.5">
                  Policy Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => updateFormField('name', e.target.value)}
                  className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors"
                  placeholder="e.g. Standard Compliance"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm text-amber-100/60 mb-1.5">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => updateFormField('description', e.target.value)}
                  className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors"
                  placeholder="Optional description"
                />
              </div>

              {/* Max Daily Spend */}
              <div>
                <label className="block text-sm text-amber-100/60 mb-1.5">
                  Max Daily Spend
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={formData.max_daily_spend}
                  onChange={(e) => updateFormField('max_daily_spend', e.target.value)}
                  className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors"
                  placeholder="10000"
                />
              </div>

              {/* Max Per Transaction */}
              <div>
                <label className="block text-sm text-amber-100/60 mb-1.5">
                  Max Per Transaction
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={formData.max_per_transaction}
                  onChange={(e) => updateFormField('max_per_transaction', e.target.value)}
                  className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors"
                  placeholder="5000"
                />
              </div>

              {/* Allowed Endpoint Categories */}
              <div>
                <label className="block text-sm text-amber-100/60 mb-1.5">
                  Allowed Endpoint Categories
                </label>
                <input
                  type="text"
                  value={formData.allowed_endpoint_categories}
                  onChange={(e) =>
                    updateFormField('allowed_endpoint_categories', e.target.value)
                  }
                  className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors"
                  placeholder="payroll, vendor, treasury (comma separated)"
                />
              </div>

              {/* Blocked Addresses */}
              <div>
                <label className="block text-sm text-amber-100/60 mb-1.5">
                  Blocked Addresses
                </label>
                <input
                  type="text"
                  value={formData.blocked_addresses}
                  onChange={(e) => updateFormField('blocked_addresses', e.target.value)}
                  className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors"
                  placeholder="Address1, Address2 (comma separated)"
                />
              </div>
            </div>

            {/* Token Whitelist */}
            <div>
              <label className="block text-sm text-amber-100/60 mb-2">
                Token Whitelist
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.usdc_enabled}
                    onChange={(e) => updateFormField('usdc_enabled', e.target.checked)}
                    className="w-4 h-4 rounded border-amber-400/20 bg-transparent accent-amber-500"
                  />
                  <span className="text-sm text-amber-100">USDC</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.usdt_enabled}
                    onChange={(e) => updateFormField('usdt_enabled', e.target.checked)}
                    className="w-4 h-4 rounded border-amber-400/20 bg-transparent accent-amber-500"
                  />
                  <span className="text-sm text-amber-100">USDT</span>
                </label>
              </div>
            </div>

            {/* Time Restrictions */}
            <div>
              <label className="block text-sm text-amber-100/60 mb-2">
                Time Restrictions
              </label>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-amber-100/40 mb-1">
                    Allowed Days
                  </label>
                  <input
                    type="text"
                    value={formData.time_restriction_days}
                    onChange={(e) =>
                      updateFormField('time_restriction_days', e.target.value)
                    }
                    className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors text-sm"
                    placeholder="Mon, Tue, Wed..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-amber-100/40 mb-1">
                    Start Hour (0-23)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={formData.time_restriction_start}
                    onChange={(e) =>
                      updateFormField('time_restriction_start', e.target.value)
                    }
                    className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors text-sm"
                    placeholder="9"
                  />
                </div>
                <div>
                  <label className="block text-xs text-amber-100/40 mb-1">
                    End Hour (0-23)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={formData.time_restriction_end}
                    onChange={(e) =>
                      updateFormField('time_restriction_end', e.target.value)
                    }
                    className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors text-sm"
                    placeholder="17"
                  />
                </div>
                <div>
                  <label className="block text-xs text-amber-100/40 mb-1">
                    Timezone
                  </label>
                  <input
                    type="text"
                    value={formData.time_restriction_timezone}
                    onChange={(e) =>
                      updateFormField('time_restriction_timezone', e.target.value)
                    }
                    className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors text-sm"
                    placeholder="UTC"
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 rounded-lg text-sm text-amber-100/60 hover:text-amber-100 border border-amber-400/20 hover:border-amber-400/40 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-lg px-6 py-2 transition-colors"
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
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && policies.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
          <Shield className="w-12 h-12 mb-4" />
          <p className="text-lg">No policies created yet</p>
          <p className="text-sm mt-1">
            Create your first compliance policy to get started
          </p>
        </div>
      )}

      {/* Policy cards */}
      {!loading && policies.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {policies.map((policy) => (
            <div
              key={policy.id}
              className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-amber-100 truncate">
                      {policy.name}
                    </h3>
                    {policy.is_active ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 text-xs font-medium">
                        <CheckCircle className="w-3 h-3" />
                        Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 text-xs font-medium">
                        <XCircle className="w-3 h-3" />
                        Inactive
                      </span>
                    )}
                  </div>
                  {policy.description && (
                    <p className="text-sm text-amber-100/40 truncate">
                      {policy.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleEdit(policy)}
                    className="p-2 rounded-lg text-amber-100/40 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                    aria-label={`Edit ${policy.name}`}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {deleteConfirm === policy.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(policy.id)}
                        className="p-2 rounded-lg text-red-400 hover:bg-red-400/10 transition-colors"
                        aria-label="Confirm delete"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="p-2 rounded-lg text-amber-100/40 hover:text-amber-100 transition-colors"
                        aria-label="Cancel delete"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(policy.id)}
                      className="p-2 rounded-lg text-amber-100/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      aria-label={`Delete ${policy.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-amber-100/40">Max Daily Spend</span>
                  <p className="text-amber-100 font-mono">
                    {formatAmount(policy.max_daily_spend)}
                  </p>
                </div>
                <div>
                  <span className="text-amber-100/40">Max Per Transaction</span>
                  <p className="text-amber-100 font-mono">
                    {formatAmount(policy.max_per_transaction)}
                  </p>
                </div>
                <div>
                  <span className="text-amber-100/40">Version</span>
                  <p className="text-amber-100">v{policy.version}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Created</span>
                  <p className="text-amber-100">{formatDate(policy.created_at)}</p>
                </div>
              </div>

              {policy.token_whitelist.length > 0 && (
                <div className="mt-3 pt-3 border-t border-amber-400/10">
                  <span className="text-xs text-amber-100/40">Tokens: </span>
                  <div className="flex gap-1.5 mt-1">
                    {policy.token_whitelist.map((mint) => (
                      <span
                        key={mint}
                        className="px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 text-xs font-mono"
                      >
                        {mint === USDC_MINT ? 'USDC' : mint === USDT_MINT ? 'USDT' : mint.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {chainTxMap[policy.id] && (
                <div className="mt-3 pt-3 border-t border-amber-400/10">
                  <a
                    href={config.txExplorerUrl(chainTxMap[policy.id])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-mono text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View on Solana
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
