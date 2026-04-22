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
} from 'lucide-react';

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
          payment_amount_lamports: amountLamports,
          payment_token_mint: compiled.data.token_whitelist[0] ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          payment_recipient: selectedAgent.authority,
          payment_endpoint_category: compiled.data.allowed_endpoint_categories[0] ?? 'aip',
          payment_timestamp: new Date().toISOString(),
          daily_spent_so_far_lamports: 0,
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

      await complianceApi.submitProof({
        operator_id: operatorId,
        policy_id: policy.id,
        payment_id: paymentId,
        proof_hash: proofData.proof_hash,
        amount_range_min: proofData.amount_range_min / 1_000_000,
        amount_range_max: proofData.amount_range_max / 1_000_000,
        token_mint: compiled.data.token_whitelist[0] ?? 'usdc',
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
        agentResponse = 'Agent is on localhost (dev mode). Compliance proof recorded successfully.';
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
      <div className="flex flex-col items-center justify-center py-20 text-amber-100/60">
        <Bot className="w-12 h-12 mb-4" />
        <p className="text-lg">Connect your wallet to access AIP Agents</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-amber-100">AIP Agents</h2>
          <p className="text-amber-100/60 text-sm mt-1">
            Agent Internet Protocol -- compliance-verified agent payments
          </p>
        </div>
        <button
          onClick={fetchAgents}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
            text-amber-100/60 hover:text-amber-400 hover:bg-amber-400/10 border border-amber-400/10
            disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-amber-100/60">Registered Agents</span>
          </div>
          <p className="text-xl font-bold text-amber-100 font-mono">{agents.length}</p>
        </div>
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-green-400/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-green-400" />
            <span className="text-xs text-amber-100/60">Live Agents</span>
          </div>
          <p className="text-xl font-bold text-amber-100 font-mono">{liveCount}</p>
        </div>
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-blue-400/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-amber-100/60">Total Capabilities</span>
          </div>
          <p className="text-xl font-bold text-amber-100 font-mono">{totalCapabilities}</p>
        </div>
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Monitor className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-amber-100/60">Network</span>
          </div>
          <p className="text-sm font-bold text-amber-400 font-mono">Solana Devnet</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-100/50" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search agents by name, DID, or capability..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[rgba(10,10,10,0.8)] border border-amber-400/20
            text-amber-100 text-sm placeholder:text-amber-100/60
            focus:outline-none focus:border-amber-400/40 transition-colors"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto" aria-label="Dismiss error">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Task Execution Panel */}
      {executing && provingStatus && (
        <div className="p-4 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-400">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">{provingStatus}</p>
              <p className="text-xs text-amber-100/60 mt-0.5">
                Compliance verification before agent payment
              </p>
            </div>
            <span className="font-mono text-lg text-amber-400/80">{formatElapsed(elapsedSec)}</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            {['Checking policy', 'Generating ZK proof', 'Recording proof', 'Verifying on Solana', 'Sending task'].map((step) => {
              const keywords = ['checking', 'generating', 'recording', 'verifying', 'sending'];
              const stepIndex = keywords.findIndex(k => step.toLowerCase().includes(k));
              const currentIndex = keywords.findIndex(k => provingStatus.toLowerCase().includes(k));
              const isDone = stepIndex < currentIndex;
              const isCurrent = stepIndex === currentIndex;
              return (
                <div key={step} className="flex items-center gap-1">
                  {isDone ? (
                    <CheckCircle className="w-3 h-3 text-green-400" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border border-amber-400/30" />
                  )}
                  <span className={`text-xs ${isDone ? 'text-green-400' : isCurrent ? 'text-amber-400' : 'text-amber-100/50'}`}>
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Task Result */}
      {taskResult && (
        <div className={`rounded-xl p-5 border ${
          taskResult.blocked
            ? 'bg-red-400/5 border-red-400/20'
            : 'bg-[rgba(10,10,10,0.8)] border-green-400/20'
        }`}>
          <div className="flex items-center gap-2 mb-4">
            {taskResult.blocked ? (
              <ShieldX className="w-5 h-5 text-red-400" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-green-400" />
            )}
            <span className={`text-sm font-semibold ${taskResult.blocked ? 'text-red-400' : 'text-green-400'}`}>
              {taskResult.blocked ? 'Payment Blocked' : 'Compliance Verified'}
            </span>
            <span className="text-xs text-amber-100/60">
              {taskResult.agentName} / {taskResult.capability}
            </span>
            <button
              onClick={() => setTaskResult(null)}
              className="ml-auto text-amber-100/50 hover:text-amber-100/60"
              aria-label="Dismiss result"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {taskResult.blockReason && (
            <div className="p-3 rounded-lg bg-red-400/10 text-red-400 text-sm mb-4">
              {taskResult.blockReason}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            {taskResult.proofHash && (
              <div className="col-span-2">
                <span className="text-amber-100/60">ZK Proof Hash</span>
                <p className="text-amber-400 font-mono mt-0.5 break-all">{taskResult.proofHash}</p>
              </div>
            )}
            {taskResult.txSignature && (
              <div>
                <span className="text-amber-100/60">Solana Transaction</span>
                <a
                  href={config.txExplorerUrl(taskResult.txSignature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono mt-0.5"
                >
                  {taskResult.txSignature.slice(0, 20)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
            {taskResult.provingTimeMs !== null && (
              <div>
                <span className="text-amber-100/60">Proving Time</span>
                <p className="text-amber-100 font-mono mt-0.5">{formatProvingTime(taskResult.provingTimeMs)}</p>
              </div>
            )}
            {taskResult.amountRangeMin !== null && taskResult.amountRangeMax !== null && (
              <div>
                <span className="text-amber-100/60">Amount Range (ZK)</span>
                <p className="text-amber-100 font-mono mt-0.5">
                  {(taskResult.amountRangeMin / 1_000_000).toFixed(2)} - {(taskResult.amountRangeMax / 1_000_000).toFixed(2)} USDC
                </p>
              </div>
            )}
            {taskResult.response && (
              <div className="col-span-2">
                <span className="text-amber-100/60">Agent Response</span>
                <div className="mt-1 p-3 rounded-lg bg-amber-400/5 border border-amber-400/10">
                  <p className="text-amber-100 text-sm whitespace-pre-wrap">{taskResult.response}</p>
                </div>
              </div>
            )}
          </div>

          {/* Audit Link */}
          {!taskResult.blocked && taskResult.proofId && (
            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-amber-400/10">
              <button
                onClick={() => {
                  const url = `${window.location.origin}/audit/${taskResult.proofId}`;
                  navigator.clipboard.writeText(url);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                  bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 border border-amber-400/20 transition-colors"
              >
                <Copy className="w-3 h-3" />
                Share Audit Link
              </button>
              <a
                href={`/audit/${taskResult.proofId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                  text-amber-100/60 hover:text-amber-400 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                View Audit Page
              </a>
              {taskResult.paymentId && (
                <span className="text-xs text-amber-100/60 font-mono ml-auto">
                  {taskResult.paymentId}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && agents.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-amber-100/60">
          <Bot className="w-12 h-12 mb-4" />
          <p className="text-lg">No AIP agents found on Solana Devnet</p>
          <p className="text-sm mt-1">
            AIP Registry: {truncateAddress(AIP_REGISTRY_PROGRAM_ID, 8)}
          </p>
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
              <div
                key={agent.did}
                className={`bg-[rgba(10,10,10,0.8)] backdrop-blur-md border rounded-xl transition-all ${
                  isSelected ? 'border-amber-400/40 ring-1 ring-amber-400/20' : 'border-amber-400/20'
                }`}
              >
                {/* Agent Header */}
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${reachable ? 'bg-green-400 animate-pulse' : 'bg-amber-400/40'}`} />
                      <div>
                        <h3 className="text-sm font-semibold text-amber-100">{agent.name}</h3>
                        <p className="text-xs text-amber-100/50 font-mono mt-0.5">
                          {truncateAddress(agent.did, 12)}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        reachable
                          ? 'bg-green-400/10 text-green-400'
                          : 'bg-amber-400/10 text-amber-400/60'
                      }`}>
                        {reachable ? 'LIVE' : 'DEV'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-400/10 text-blue-400 text-xs">
                        v{agent.version}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Capabilities as pills */}
                      <div className="hidden md:flex items-center gap-1">
                        {agent.capabilities.map((cap) => (
                          <span
                            key={cap.id}
                            className="px-2 py-0.5 rounded bg-amber-400/5 text-amber-100/60 text-xs"
                          >
                            {cap.id} <span className="text-amber-400">${cap.pricing.amount}</span>
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.did)}
                        className="p-1.5 rounded-lg hover:bg-amber-400/10 text-amber-100/60 hover:text-amber-400 transition-colors"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded: Details + Task Form */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-amber-400/10 pt-4 space-y-4">
                    {/* Agent Details */}
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-amber-100/60">DID</span>
                        <p className="text-amber-100 font-mono mt-0.5 break-all">{agent.did}</p>
                      </div>
                      <div>
                        <span className="text-amber-100/60">Endpoint</span>
                        <p className="text-amber-100 font-mono mt-0.5 break-all">{agent.endpoint}</p>
                      </div>
                      <div>
                        <span className="text-amber-100/60">Authority</span>
                        <p className="text-amber-100 font-mono mt-0.5">
                          <a
                            href={config.explorerUrl(agent.authority)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-400 hover:text-amber-300"
                          >
                            {truncateAddress(agent.authority, 6)}
                            <ExternalLink className="w-3 h-3 inline ml-1" />
                          </a>
                        </p>
                      </div>
                      <div>
                        <span className="text-amber-100/60">On-Chain Account</span>
                        <p className="text-amber-100 font-mono mt-0.5">
                          <a
                            href={config.explorerUrl(agent.publicKey)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-400 hover:text-amber-300"
                          >
                            {truncateAddress(agent.publicKey, 6)}
                            <ExternalLink className="w-3 h-3 inline ml-1" />
                          </a>
                        </p>
                      </div>
                    </div>

                    {/* Capabilities */}
                    <div>
                      <span className="text-xs text-amber-100/60 block mb-2">Capabilities</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {agent.capabilities.map((cap) => (
                          <button
                            key={cap.id}
                            onClick={() => {
                              setSelectedAgent(agent);
                              setSelectedCapability(cap.id);
                            }}
                            className={`p-3 rounded-lg border text-left transition-all ${
                              selectedAgent?.did === agent.did && selectedCapability === cap.id
                                ? 'border-amber-400/40 bg-amber-400/10'
                                : 'border-amber-400/10 bg-amber-400/5 hover:border-amber-400/30'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-amber-100">{cap.id}</span>
                              <span className="flex items-center gap-1 text-xs text-amber-400 font-mono">
                                <DollarSign className="w-3 h-3" />
                                {cap.pricing.amount} {cap.pricing.token}
                              </span>
                            </div>
                            {cap.description && (
                              <p className="text-xs text-amber-100/60 mt-1">{cap.description}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Task Input */}
                    {selectedAgent?.did === agent.did && selectedCapability && (
                      <div className="space-y-3 p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                        <div className="flex items-center gap-2">
                          <Send className="w-4 h-4 text-amber-400" />
                          <span className="text-sm font-semibold text-amber-100">Execute Task</span>
                          <span className="text-xs text-amber-100/50">
                            {selectedCapability} on {agent.name}
                          </span>
                        </div>

                        <textarea
                          value={taskInput}
                          onChange={(e) => setTaskInput(e.target.value)}
                          placeholder="Enter your task input..."
                          rows={3}
                          className="w-full px-3 py-2 rounded-lg bg-[rgba(0,0,0,0.8)] border border-amber-400/20
                            text-amber-100 text-sm placeholder:text-amber-100/60
                            focus:outline-none focus:border-amber-400/40 resize-none transition-colors"
                        />

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs text-amber-100/50">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>ZK compliance proof will be generated before payment</span>
                          </div>
                          <button
                            onClick={executeTask}
                            disabled={executing || !taskInput.trim()}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                              bg-amber-500 text-black hover:bg-amber-400
                              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {executing ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            {executing ? 'Verifying...' : 'Execute with Compliance'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* AIP Task History */}
      {aipProofs.length > 0 && (
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-amber-400/10">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-amber-100">AIP Task History</h3>
              <span className="text-xs text-amber-100/50">{aipProofs.length} records</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-400/10">
                  <th className="text-left px-4 py-3 text-xs font-medium text-amber-100/50 uppercase">Payment ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-amber-100/50 uppercase">Proof Hash</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-amber-100/50 uppercase">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-amber-100/50 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-amber-100/50 uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-amber-100/50 uppercase">TX</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-amber-100/50 uppercase">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-400/10">
                {aipProofs.map((proof) => (
                  <tr key={proof.id} className="hover:bg-amber-400/5 transition-colors">
                    <td className="px-4 py-3 text-xs font-mono text-amber-100">
                      {truncateAddress(proof.payment_id, 8)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-amber-400">
                      {truncateAddress(proof.proof_hash, 6)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-amber-100">
                      {proof.amount_range_min.toFixed(2)} - {proof.amount_range_max.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {proof.is_compliant ? (
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle className="w-3 h-3" /> Compliant
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <AlertTriangle className="w-3 h-3" /> Violation
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-amber-100/60">
                      {new Date(proof.verified_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {proof.tx_signature ? (
                        <a
                          href={config.txExplorerUrl(proof.tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-400 hover:text-amber-300"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        <span className="text-amber-100/60">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <a
                        href={`/audit/${proof.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-400 hover:text-amber-300 text-xs"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Registry Info */}
      <div className="flex items-center justify-center gap-2 text-xs text-amber-100/60 pt-4">
        <span>AIP Registry:</span>
        <a
          href={config.explorerUrl(AIP_REGISTRY_PROGRAM_ID)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-amber-400/40 hover:text-amber-400 transition-colors"
        >
          {AIP_REGISTRY_PROGRAM_ID}
          <ExternalLink className="w-3 h-3 inline ml-1" />
        </a>
        <span className="text-amber-100/10">|</span>
        <span>Data source: Solana Devnet on-chain</span>
      </div>
    </div>
  );
}

const AIP_REGISTRY_PROGRAM_ID = 'CgchXu2dRV3r9E1YjRhp4kbeLLtv1Xz61yoerJzp1Vbc';
