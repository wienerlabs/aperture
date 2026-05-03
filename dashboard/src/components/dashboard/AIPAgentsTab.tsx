'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { config } from '@/lib/config';
import { policyApi, complianceApi } from '@/lib/api';
import {
  buildVerifyPaymentProofV2Ix,
  deriveOperatorPDA,
  derivePolicyPDA,
  readEffectiveDailySpentLamports,
  sha256Bytes,
} from '@/lib/anchor-instructions';
import { truncateAddress } from '@/lib/utils';
import { useApertureWalletModal } from '@/components/shared/WalletModal';
import {
  Bot,
  Loader2,
  ExternalLink,
  ShieldCheck,
  ShieldX,
  Globe,
  Monitor,
  DollarSign,
  Search,
  Send,
  CheckCircle,
  Copy,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { MetricCard } from './overview/MetricCard';

interface AIPCapability {
  readonly id: string;
  readonly description: string;
  readonly pricing: {
    readonly amount: string;
    readonly token: string;
    readonly network: string;
  };
}

interface AIPAgent {
  readonly authority: string;
  readonly walletAddress: string;
  readonly agentId: string;
  readonly did: string;
  readonly name: string;
  readonly endpoint: string;
  readonly capabilities: readonly AIPCapability[];
  readonly version: string;
  readonly publicKey: string;
}

interface TaskResult {
  readonly agentName: string;
  readonly capability: string;
  readonly response: string | null;
  readonly proofHash: string | null;
  readonly proofId: string | null;
  readonly paymentId: string | null;
  readonly txSignature: string | null;
  readonly isCompliant: boolean;
  readonly amountRangeMin: number | null;
  readonly amountRangeMax: number | null;
  readonly provingTimeMs: number | null;
  readonly blocked: boolean;
  readonly blockReason: string | null;
}

function formatProvingTime(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${Math.round(s)}s`;
  return `${s.toFixed(2)}s`;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AIPAgentsTab() {
  const operatorId = useOperatorId();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible: openWalletModal } = useApertureWalletModal();

  const [agents, setAgents] = useState<readonly AIPAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Task execution state
  const [selectedAgent, setSelectedAgent] = useState<AIPAgent | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [provingStatus, setProvingStatus] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // AIP task history from compliance API
  const [aipProofs, setAipProofs] = useState<readonly import('@/lib/api').ProofRecord[]>([]);

  const fetchAipHistory = useCallback(async () => {
    if (!operatorId) return;
    try {
      const response = await complianceApi.listProofsByOperator(operatorId, 1, 50);
      const aipOnly = response.data.filter(p => p.payment_id.startsWith('aip-'));
      setAipProofs(aipOnly);
    } catch {
      // Non-blocking
    }
  }, [operatorId]);

  useEffect(() => {
    fetchAipHistory();
  }, [fetchAipHistory]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/aip/agents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error ?? 'Failed to fetch agents');
      setAgents(body.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch AIP agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Elapsed timer
  useEffect(() => {
    if (!executing) return;
    setElapsedSec(0);
    const interval = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [executing]);

  const filteredAgents = searchQuery
    ? agents.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.did.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.capabilities.some(c => c.id.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : agents;

  const isReachable = (endpoint: string): boolean =>
    !endpoint.includes('localhost') && !endpoint.includes('127.0.0.1');

  const liveCount = agents.filter(a => isReachable(a.endpoint)).length;
  const totalCapabilities = agents.reduce((sum, a) => sum + a.capabilities.length, 0);

  async function executeTask(): Promise<void> {
    if (!selectedAgent || !selectedCapability || !taskInput.trim()) return;
    if (!operatorId) return;
    if (!publicKey || !sendTransaction) {
      openWalletModal(true);
      return;
    }

    setExecuting(true);
    setTaskResult(null);
    setProvingStatus(null);
    setError(null);

    try {
      // 1. Fetch operator's active policy
      setProvingStatus('Checking compliance policy...');
      const policiesRes = await policyApi.list(operatorId);
      const policies = policiesRes.data;

      if (policies.length === 0) {
        setTaskResult({
          agentName: selectedAgent.name,
          capability: selectedCapability,
          response: null,
          proofHash: null,
          proofId: null,
          paymentId: null,
          txSignature: null,
          isCompliant: false,
          amountRangeMin: null,
          amountRangeMax: null,
          provingTimeMs: null,
          blocked: true,
          blockReason: 'No active policy found. Create a policy first.',
        });
        setExecuting(false);
        setProvingStatus(null);
        return;
      }

      const policy = policies[0];
      const compiled = await policyApi.compile(policy.id);
      if (!compiled.data) {
        setTaskResult({
          agentName: selectedAgent.name,
          capability: selectedCapability,
          response: null,
          proofHash: null,
          proofId: null,
          paymentId: null,
          txSignature: null,
          isCompliant: false,
          amountRangeMin: null,
          amountRangeMax: null,
          provingTimeMs: null,
          blocked: true,
          blockReason: 'Failed to compile policy for ZK circuit.',
        });
        setExecuting(false);
        setProvingStatus(null);
        return;
      }

      // Find capability pricing
      const capability = selectedAgent.capabilities.find(c => c.id === selectedCapability);
      const priceUsdc = parseFloat(capability?.pricing.amount ?? '0');
      const amountLamports = Math.round(priceUsdc * 1_000_000);

      // 2. Generate Groth16 ZK proof via Circom prover-service
      setProvingStatus('Generating ZK proof... this may take several minutes');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600_000);

      // The AIP task call is an x402-style payment from this wallet to the
      // agent's authority. Compliance is enforced inside the verifier
      // program (verify_payment_proof_v2_with_transfer) so any token the
      // active policy whitelists works — pick the first whitelisted entry,
      // preferring USDC, falling back to aUSDC for legacy policies.
      const sentinelMint =
        compiled.data.token_whitelist.find((m: string) => m === config.tokens.usdc) ??
        compiled.data.token_whitelist[0] ??
        config.tokens.aUSDC;
      if (!sentinelMint) {
        throw new Error(
          'Active policy has no whitelisted tokens — edit the policy to enable USDC/USDT/aUSDC.',
        );
      }
      const dailySpentBeforeLamports = (
        await readEffectiveDailySpentLamports(connection, publicKey)
      ).toString();
      const proveRes = await fetch(`${config.proverServiceUrl}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          policy_id: compiled.data.policy_id,
          operator_id: compiled.data.operator_id,
          max_daily_spend_lamports: parseInt(compiled.data.max_daily_spend_lamports, 10),
          max_per_transaction_lamports: parseInt(compiled.data.max_per_transaction_lamports, 10),
          allowed_endpoint_categories: compiled.data.allowed_endpoint_categories,
          blocked_addresses: compiled.data.blocked_addresses,
          token_whitelist: compiled.data.token_whitelist,
          time_restrictions: compiled.data.time_restrictions ?? [],
          payment_amount_lamports: amountLamports,
          payment_token_mint: sentinelMint,
          payment_recipient: selectedAgent.authority,
          payment_endpoint_category: compiled.data.allowed_endpoint_categories[0] ?? 'aip',
          daily_spent_before_lamports: dailySpentBeforeLamports,
          current_unix_timestamp: Math.floor(Date.now() / 1000),
        }),
      });
      clearTimeout(timeoutId);

      if (!proveRes.ok) {
        const errBody = await proveRes.json().catch(() => ({ error: 'Prover error' }));

        // Check if non-compliant
        if (errBody.is_compliant === false) {
          setTaskResult({
            agentName: selectedAgent.name,
            capability: selectedCapability,
            response: null,
            proofHash: errBody.proof_hash ?? null,
            txSignature: null,
            isCompliant: false,
            amountRangeMin: null,
            amountRangeMax: null,
            provingTimeMs: null,
            blocked: true,
            blockReason: `Payment violates policy: ${errBody.error ?? 'non-compliant'}`,
          });
          setExecuting(false);
          setProvingStatus(null);
          return;
        }

        throw new Error(errBody.error ?? `Prover returned ${proveRes.status}`);
      }

      const proofData = await proveRes.json();

      // If proof says non-compliant, block the payment
      if (!proofData.is_compliant) {
        setTaskResult({
          agentName: selectedAgent.name,
          capability: selectedCapability,
          response: null,
          proofHash: proofData.proof_hash,
          proofId: null,
          paymentId: null,
          txSignature: null,
          isCompliant: false,
          amountRangeMin: proofData.amount_range_min,
          amountRangeMax: proofData.amount_range_max,
          provingTimeMs: proofData.proving_time_ms,
          blocked: true,
          blockReason: 'Payment does not comply with operator policy. Transaction blocked.',
        });
        setExecuting(false);
        setProvingStatus(null);
        return;
      }

      // 3. Submit proof record to compliance API
      setProvingStatus('Recording compliance proof...');
      const paymentId = `aip-${selectedAgent.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // amount_range_{min,max} mirror the actual transfer amount; the
      // prover doesn't return them as separate fields anymore (they used
      // to be bucketed; now the proof commits the exact value).
      const amountInTokens = amountLamports / 1_000_000;
      await complianceApi.submitProof({
        operator_id: operatorId,
        policy_id: policy.id,
        payment_id: paymentId,
        proof_hash: proofData.proof_hash,
        amount_range_min: amountInTokens,
        amount_range_max: amountInTokens,
        token_mint: sentinelMint,
        is_compliant: proofData.is_compliant,
        verified_at: proofData.verification_timestamp,
      });

      // 4. Verify proof on-chain
      setProvingStatus('Verifying proof on Solana...');
      let txSig = '';

      const proofA = Uint8Array.from(Buffer.from(proofData.groth16.proof_a, 'base64'));
      const proofB = Uint8Array.from(Buffer.from(proofData.groth16.proof_b, 'base64'));
      const proofC = Uint8Array.from(Buffer.from(proofData.groth16.proof_c, 'base64'));
      const publicInputs = proofData.groth16.public_inputs.map(
        (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'))
      );

      const [operatorPDA] = deriveOperatorPDA(publicKey);
      const policyIdBytes = await sha256Bytes(policy.id);
      const [policyPDA] = derivePolicyPDA(operatorPDA, policyIdBytes);

      const verifyIx = buildVerifyPaymentProofV2Ix(
        publicKey,
        publicKey,
        policyPDA,
        proofA,
        proofB,
        proofC,
        publicInputs,
      );

      const tx = new Transaction().add(verifyIx);
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      txSig = await sendTransaction(tx, connection);
      setProvingStatus('Confirming Solana transaction...');
      await connection.confirmTransaction(txSig, 'confirmed');

      // 5. Save tx_signature to backend and get proof ID
      let proofRecordId: string | null = null;
      if (txSig) {
        const proofRes = await complianceApi.getProofByPayment(paymentId);
        if (proofRes.data) {
          await complianceApi.updateProofTxSignature(proofRes.data.id, txSig);
          proofRecordId = proofRes.data.id;
        }
      }

      // 6. Send task to AIP agent (if reachable)
      let agentResponse: string | null = null;
      if (isReachable(selectedAgent.endpoint)) {
        setProvingStatus('Sending task to AIP agent...');
        try {
          const taskRes = await fetch(selectedAgent.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'task/create',
              params: {
                capability: selectedCapability,
                input: taskInput,
              },
              id: paymentId,
            }),
          });

          if (taskRes.ok) {
            const taskBody = await taskRes.json();
            const taskId = taskBody.result?.taskId;

            if (taskId) {
              // Poll for task completion
              for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 2000));
                const statusRes = await fetch(selectedAgent.endpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'task/status',
                    params: { taskId },
                    id: `${paymentId}-status`,
                  }),
                });

                if (statusRes.ok) {
                  const statusBody = await statusRes.json();
                  if (statusBody.result?.status === 'COMPLETED') {
                    agentResponse = statusBody.result.artifact ?? 'Task completed';
                    break;
                  }
                  if (statusBody.result?.status === 'FAILED') {
                    agentResponse = `Agent error: ${statusBody.result.error ?? 'Unknown'}`;
                    break;
                  }
                }
              }
            }
          }
        } catch {
          agentResponse = 'Agent endpoint not reachable (task recorded with compliance proof)';
        }
      } else {
        // No public endpoint registered for this AIP agent — only the
        // on-chain compliance side ran. Surface that explicitly so the
        // operator does not assume a downstream call happened.
        agentResponse = 'AIP agent has no published endpoint. Compliance proof anchored on-chain; downstream task call skipped.';
      }

      setTaskResult({
        agentName: selectedAgent.name,
        capability: selectedCapability,
        response: agentResponse,
        proofHash: proofData.proof_hash,
        proofId: proofRecordId,
        paymentId,
        txSignature: txSig || null,
        isCompliant: true,
        amountRangeMin: proofData.amount_range_min,
        amountRangeMax: proofData.amount_range_max,
        provingTimeMs: proofData.proving_time_ms,
        blocked: false,
        blockReason: null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Task execution failed');
      // Refresh history
      await fetchAipHistory();
    } finally {
      setExecuting(false);
      setProvingStatus(null);
    }
  }

  if (!operatorId) {
    return (
      <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
          <Wallet className="h-6 w-6" />
        </span>
        <h2 className="font-display text-[24px] tracking-[-0.012em] text-black">
          Connect a wallet to access AIP Agents
        </h2>
        <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
          Agent Internet Protocol routes capability calls through Aperture&apos;s
          compliance verifier. Connect to discover and pay agents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero ribbon */}
      <section
        className="relative overflow-hidden rounded-[24px] border border-black/8 bg-white p-6 sm:p-8"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 50% 80% at 95% 10%, rgba(248,179,0,0.18) 0%, rgba(248,179,0,0) 65%)',
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-aperture/15 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark w-fit">
              <Bot className="h-3 w-3" />
              Agent Internet Protocol
            </span>
            <h1 className="font-display text-[36px] sm:text-[44px] leading-[1.04] tracking-[-0.012em] text-black">
              Pay agents.
              <br />
              Compliance verified first.
            </h1>
            <p className="text-[14px] text-black/55 tracking-tighter max-w-2xl">
              Discover registered AIP agents on Solana Devnet and call their priced
              capabilities. Every call is gated by a ZK compliance proof before any
              token leaves your wallet.
            </p>
          </div>

          <button
            onClick={fetchAgents}
            disabled={loading}
            className="ap-btn-ghost-light inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </section>

      {/* Stats row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Registered Agents"
          value={agents.length.toLocaleString()}
          icon={Bot}
          hint="Live AIP registry on Devnet"
        />
        <MetricCard
          label="Live Agents"
          value={liveCount.toLocaleString()}
          icon={Globe}
          hint="Reachable HTTP endpoints"
        />
        <MetricCard
          label="Capabilities"
          value={totalCapabilities.toLocaleString()}
          icon={Zap}
          hint="Priced endpoints across all agents"
        />
        <MetricCard
          label="Network"
          value="Devnet"
          icon={Monitor}
          hint="Solana cluster"
        />
      </section>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-black/45" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search agents by name, DID, or capability…"
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-black/12 hover:border-aperture/40 focus:border-aperture text-[14px] text-black placeholder:text-black/35 focus:outline-none transition-colors"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="ap-card p-4 flex items-center gap-3" style={{ borderColor: '#fca5a5' }}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-600" />
          <p className="text-[13px] text-red-700 tracking-tighter">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto flex-shrink-0 text-black/45 hover:text-black"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Task Execution Panel — animated proving stepper */}
      {executing && provingStatus && (
        <div className="ap-card p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin shrink-0 text-aperture-dark" />
            <div className="flex-1">
              <p className="text-[14px] font-medium tracking-tighter text-black">
                {provingStatus}
              </p>
              <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
                Compliance verification before agent payment
              </p>
            </div>
            <span className="font-mono text-[16px] text-aperture-dark">
              {formatElapsed(elapsedSec)}
            </span>
          </div>
          <ol className="flex items-center gap-2 flex-wrap">
            {[
              'Checking policy',
              'Generating ZK proof',
              'Recording proof',
              'Verifying on Solana',
              'Sending task',
            ].map((step) => {
              const keywords = [
                'checking',
                'generating',
                'recording',
                'verifying',
                'sending',
              ];
              const stepIndex = keywords.findIndex((k) =>
                step.toLowerCase().includes(k),
              );
              const currentIndex = keywords.findIndex((k) =>
                provingStatus.toLowerCase().includes(k),
              );
              const isDone = stepIndex < currentIndex;
              const isCurrent = stepIndex === currentIndex;
              return (
                <li
                  key={step}
                  className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-medium tracking-tighter ${
                    isDone
                      ? 'bg-green-500/10 text-green-700'
                      : isCurrent
                        ? 'bg-aperture/15 text-aperture-dark'
                        : 'bg-black/5 text-black/55'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle className="h-3 w-3" />
                  ) : isCurrent ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="h-2 w-2 rounded-pill bg-black/15" />
                  )}
                  {step}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Task Result */}
      {taskResult && (
        <div
          className={`rounded-[20px] border bg-white p-5 sm:p-6 ${
            taskResult.blocked ? 'border-red-500/30' : 'border-green-500/25'
          }`}
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          <header className="flex items-center gap-2 mb-4 flex-wrap">
            {taskResult.blocked ? (
              <ShieldX className="h-5 w-5 text-red-600" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-green-600" />
            )}
            <span
              className={`font-display text-[18px] tracking-[-0.005em] ${
                taskResult.blocked ? 'text-red-700' : 'text-green-700'
              }`}
            >
              {taskResult.blocked ? 'Payment Blocked' : 'Compliance Verified'}
            </span>
            <span className="text-[12px] text-black/55 tracking-tighter">
              {taskResult.agentName} / {taskResult.capability}
            </span>
            <button
              onClick={() => setTaskResult(null)}
              className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/55 hover:bg-black/5 hover:text-black transition-colors"
              aria-label="Dismiss result"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {taskResult.blockReason && (
            <div className="rounded-[12px] border border-red-500/25 bg-red-500/5 p-3 text-[13px] text-red-700 mb-4">
              {taskResult.blockReason}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3">
            {taskResult.proofHash && (
              <ResultCell
                label="ZK Proof Hash"
                value={taskResult.proofHash}
                mono
                fullWidth
              />
            )}
            {taskResult.txSignature && (
              <ResultCell
                label="Solana Transaction"
                value={`${taskResult.txSignature.slice(0, 20)}…`}
                href={config.txExplorerUrl(taskResult.txSignature)}
                mono
              />
            )}
            {taskResult.provingTimeMs !== null && (
              <ResultCell
                label="Proving Time"
                value={formatProvingTime(taskResult.provingTimeMs)}
                mono
              />
            )}
            {taskResult.amountRangeMin !== null && taskResult.amountRangeMax !== null && (
              <ResultCell
                label="Amount Range (ZK)"
                value={`${(taskResult.amountRangeMin / 1_000_000).toFixed(2)} – ${(
                  taskResult.amountRangeMax / 1_000_000
                ).toFixed(2)} USDC`}
                mono
              />
            )}
            {taskResult.response && (
              <div className="col-span-2 rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-2.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-black/55 block mb-1">
                  Agent Response
                </span>
                <p className="text-[13px] text-black tracking-tighter whitespace-pre-wrap">
                  {taskResult.response}
                </p>
              </div>
            )}
          </dl>

          {/* Audit Link */}
          {!taskResult.blocked && taskResult.proofId && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-black/8">
              <button
                onClick={() => {
                  const url = `${window.location.origin}/audit/${taskResult.proofId}`;
                  navigator.clipboard.writeText(url);
                }}
                className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-black hover:border-aperture/40 transition-colors"
              >
                <Copy className="h-3 w-3" />
                Share audit link
              </button>
              <a
                href={`/audit/${taskResult.proofId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-aperture-dark hover:border-aperture/40 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                View audit page
              </a>
              {taskResult.paymentId && (
                <span className="text-[11px] text-black/55 font-mono ml-auto">
                  {taskResult.paymentId}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="ap-card p-12 flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-aperture animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && agents.length === 0 && !error && (
        <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
            <Bot className="h-6 w-6" />
          </span>
          <h3 className="font-display text-[22px] tracking-[-0.005em] text-black">
            No AIP agents found
          </h3>
          <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
            The AIP registry on Solana Devnet hasn&apos;t returned any agents yet.
            Refresh in a moment, or register an agent via the AIP SDK.
          </p>
          <span className="text-[11px] font-mono text-black/45 mt-1">
            Registry · {truncateAddress(AIP_REGISTRY_PROGRAM_ID, 8)}
          </span>
        </div>
      )}

      {/* Agent Cards */}
      {!loading && filteredAgents.length > 0 && (
        <div className="space-y-3">
          {filteredAgents.map((agent) => {
            const reachable = isReachable(agent.endpoint);
            const isExpanded = expandedAgent === agent.did;
            const isSelected = selectedAgent?.did === agent.did;

            return (
              <article
                key={agent.did}
                className={`ap-card transition-all overflow-hidden ${
                  isSelected ? 'ring-2 ring-aperture/30' : ''
                }`}
              >
                {/* Agent Header */}
                <div className="p-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
                        <Bot className="h-4 w-4" />
                        {reachable && (
                          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-pill bg-green-500 ring-2 ring-white animate-pulse" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
                            {agent.name}
                          </h3>
                          <span
                            className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-medium tracking-tighter ${
                              reachable
                                ? 'bg-green-500/10 text-green-700'
                                : 'bg-aperture/15 text-aperture-dark'
                            }`}
                          >
                            {reachable ? 'Live' : 'Dev only'}
                          </span>
                          <span className="inline-flex items-center rounded-pill bg-black/5 px-2 py-0.5 text-[11px] font-mono text-black/65">
                            v{agent.version}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-black/55 mt-0.5 truncate">
                          {truncateAddress(agent.did, 12)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="hidden md:flex items-center gap-1.5">
                        {agent.capabilities.slice(0, 3).map((cap) => (
                          <span
                            key={cap.id}
                            className="inline-flex items-center gap-1 rounded-pill bg-[rgba(248,179,0,0.06)] px-2 py-0.5 text-[11px] font-mono text-black/65"
                          >
                            {cap.id}{' '}
                            <span className="text-aperture-dark">${cap.pricing.amount}</span>
                          </span>
                        ))}
                        {agent.capabilities.length > 3 && (
                          <span className="text-[11px] text-black/55 tracking-tighter">
                            +{agent.capabilities.length - 3}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.did)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/55 hover:text-black hover:bg-black/5 transition-colors"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded: Details + Task Form */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-black/8 pt-4 flex flex-col gap-5 bg-[rgba(248,179,0,0.02)]">
                    {/* Agent Details */}
                    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <DetailCell label="DID" value={truncateAddress(agent.did, 8)} mono />
                      <DetailCell label="Endpoint" value={agent.endpoint} mono />
                      <DetailCell
                        label="Authority"
                        value={truncateAddress(agent.authority, 6)}
                        href={config.explorerUrl(agent.authority)}
                        mono
                      />
                      <DetailCell
                        label="On-chain"
                        value={truncateAddress(agent.publicKey, 6)}
                        href={config.explorerUrl(agent.publicKey)}
                        mono
                      />
                    </dl>

                    {/* Capabilities */}
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] uppercase tracking-[0.08em] text-black/55">
                        Capabilities
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {agent.capabilities.map((cap) => {
                          const active =
                            selectedAgent?.did === agent.did &&
                            selectedCapability === cap.id;
                          return (
                            <button
                              key={cap.id}
                              onClick={() => {
                                setSelectedAgent(agent);
                                setSelectedCapability(cap.id);
                              }}
                              className={`group flex flex-col gap-1.5 rounded-[14px] border px-3 py-2.5 text-left transition-all ${
                                active
                                  ? 'border-aperture/45 bg-[rgba(248,179,0,0.08)]'
                                  : 'border-black/8 bg-white hover:border-aperture/40'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[13px] font-medium tracking-tighter text-black">
                                  {cap.id}
                                </span>
                                <span className="inline-flex items-center gap-0.5 rounded-pill bg-aperture/12 px-2 py-0.5 text-[11px] font-mono text-aperture-dark">
                                  <DollarSign className="h-3 w-3" />
                                  {cap.pricing.amount} {cap.pricing.token}
                                </span>
                              </div>
                              {cap.description && (
                                <p className="text-[12px] text-black/55 tracking-tighter">
                                  {cap.description}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Task Input */}
                    {selectedAgent?.did === agent.did && selectedCapability && (
                      <div className="rounded-[16px] border border-aperture/30 bg-white p-4 flex flex-col gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Send className="h-4 w-4 text-aperture-dark" />
                          <span className="font-display text-[16px] tracking-[-0.005em] text-black">
                            Execute Task
                          </span>
                          <span className="text-[12px] text-black/55 tracking-tighter">
                            {selectedCapability} on {agent.name}
                          </span>
                        </div>

                        <textarea
                          value={taskInput}
                          onChange={(e) => setTaskInput(e.target.value)}
                          placeholder="Enter your task input…"
                          rows={3}
                          className="w-full px-3 py-2.5 bg-white border border-black/12 hover:border-aperture/40 focus:border-aperture text-[14px] text-black placeholder:text-black/35 focus:outline-none resize-none transition-colors"
                        />

                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 text-[12px] text-black/55 tracking-tighter">
                            <ShieldCheck className="h-3.5 w-3.5 text-aperture-dark" />
                            <span>ZK compliance proof generated before payment.</span>
                          </div>
                          <button
                            onClick={executeTask}
                            disabled={executing || !taskInput.trim()}
                            className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {executing ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            {executing ? 'Verifying…' : 'Execute with Compliance'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* AIP Task History */}
      {aipProofs.length > 0 && (
        <section className="ap-card overflow-hidden">
          <header className="px-5 py-4 flex items-center justify-between gap-3 border-b border-black/8">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-aperture-dark" />
              <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
                AIP Task History
              </h3>
            </div>
            <span className="inline-flex items-center rounded-pill bg-aperture/12 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark">
              {aipProofs.length} records
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[rgba(248,179,0,0.04)]">
                  {['Payment', 'Proof Hash', 'Amount', 'Status', 'Date', 'Tx', 'Audit'].map(
                    (label) => (
                      <th
                        key={label}
                        className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-black/55"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/8">
                {aipProofs.map((proof) => (
                  <tr
                    key={proof.id}
                    className="hover:bg-[rgba(248,179,0,0.04)] transition-colors"
                  >
                    <td className="px-4 py-3 text-[12px] font-mono text-black">
                      {truncateAddress(proof.payment_id, 8)}
                    </td>
                    <td className="px-4 py-3 text-[12px] font-mono text-aperture-dark">
                      {truncateAddress(proof.proof_hash, 6)}
                    </td>
                    <td className="px-4 py-3 text-[12px] font-mono text-black">
                      {proof.amount_range_min.toFixed(2)} – {proof.amount_range_max.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {proof.is_compliant ? (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-green-500/10 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-green-700">
                          <CheckCircle className="h-3 w-3" /> Compliant
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-red-500/12 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-red-700">
                          <AlertTriangle className="h-3 w-3" /> Violation
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-black/65 tracking-tighter">
                      {new Date(proof.verified_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      {proof.tx_signature ? (
                        <a
                          href={config.txExplorerUrl(proof.tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-black/35">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      <a
                        href={`/audit/${proof.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-aperture-dark hover:text-black transition-colors"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Registry footer */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12px] tracking-tighter text-black/55 pt-4">
        <span className="uppercase tracking-[0.08em] text-[11px]">AIP Registry</span>
        <a
          href={config.explorerUrl(AIP_REGISTRY_PROGRAM_ID)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-aperture-dark hover:text-black transition-colors"
        >
          {truncateAddress(AIP_REGISTRY_PROGRAM_ID, 6)}
          <ExternalLink className="h-3 w-3" />
        </a>
        <span className="text-black/30">·</span>
        <span>Solana Devnet on-chain</span>
      </div>
    </div>
  );
}

function ResultCell({
  label,
  value,
  href,
  mono,
  fullWidth,
}: {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-2.5 ${
        fullWidth ? 'col-span-2' : ''
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">{label}</div>
      <div className={`mt-0.5 text-[13px] tracking-tighter break-all text-black ${mono ? 'font-mono' : ''}`}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
          >
            {value}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function DetailCell({
  label,
  value,
  href,
  mono,
}: {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">{label}</div>
      <div
        className={`mt-0.5 text-[12px] tracking-tighter break-all text-black ${mono ? 'font-mono' : ''}`}
      >
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
          >
            {value}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

const AIP_REGISTRY_PROGRAM_ID = 'CgchXu2dRV3r9E1YjRhp4kbeLLtv1Xz61yoerJzp1Vbc';
