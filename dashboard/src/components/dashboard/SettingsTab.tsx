'use client';

import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Settings,
  Wallet,
  Users,
  Server,
  CheckCircle,
  LogOut,
  Loader2,
  ExternalLink,
  Cpu,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { config } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';
import { multisigApi, type MultisigBinding } from '@/lib/api';
import { AgentStripeCard } from './AgentStripeCard';
import { SettingsSection } from './shared/SettingsSection';
import { CopyableField } from './shared/CopyableField';
import { MultisigOverviewCard } from './multisig/MultisigOverviewCard';
import { MultisigBindingCard } from './multisig/MultisigBindingCard';

export function SettingsTab() {
  const { publicKey, disconnect, connected } = useWallet();
  const operatorId = useOperatorId();

  const [binding, setBinding] = useState<MultisigBinding | null>(null);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [bindingError, setBindingError] = useState<string | null>(null);

  const walletAddress = publicKey?.toBase58() ?? null;

  const loadBinding = useCallback(async (): Promise<void> => {
    if (!operatorId) return;
    setBindingLoading(true);
    setBindingError(null);
    try {
      const result = await multisigApi.getBinding(operatorId);
      setBinding(result);
    } catch (err: unknown) {
      setBindingError(err instanceof Error ? err.message : 'Failed to load multisig');
    } finally {
      setBindingLoading(false);
    }
  }, [operatorId]);

  useEffect(() => {
    void loadBinding();
  }, [loadBinding]);

  return (
    <div className="space-y-6 max-w-3xl">
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
        <div className="relative flex flex-col gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-aperture/15 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark w-fit">
            <Settings className="h-3 w-3" />
            Operator Settings
          </span>
          <h1 className="font-display text-[36px] sm:text-[44px] leading-[1.04] tracking-[-0.012em] text-black">
            Wallet, multisig &amp; APIs
          </h1>
          <p className="text-[14px] text-black/55 tracking-tighter max-w-2xl">
            Aperture is wallet-first. Your operator identity, multisig governance, and
            backend service URLs all live in one place. No admin console required.
          </p>
        </div>
      </section>

      {/* Wallet Connection */}
      <SettingsSection
        icon={Wallet}
        title="Wallet Connection"
        description="The connected wallet acts as your operator identity across every service."
        action={
          connected && (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-green-500/10 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-green-700">
              <CheckCircle className="h-3 w-3" />
              Connected
            </span>
          )
        }
      >
        {connected && walletAddress ? (
          <>
            <CopyableField
              label="Wallet address"
              value={walletAddress}
              helper="Shared with backend services as operator_id."
            />
            <button
              onClick={() => disconnect()}
              className="inline-flex items-center gap-2 rounded-pill border border-red-500/30 bg-red-500/8 px-4 py-2 text-[13px] font-medium tracking-tighter text-red-700 hover:bg-red-500/12 transition-colors w-fit"
            >
              <LogOut className="h-4 w-4" />
              Disconnect Wallet
            </button>
          </>
        ) : (
          <p className="text-[14px] text-black/55 tracking-tighter">
            No wallet connected. Use Phantom or Solflare via the wallet adapter to
            access full functionality.
          </p>
        )}
      </SettingsSection>

      {/* Squads Multisig — full lifecycle */}
      <SettingsSection
        icon={Users}
        title="Squads Multisig"
        description="Bind a Squads V4 multisig to this operator. Once bound, every register_policy and update_policy call must go through the multisig vault PDA."
        action={
          binding ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-green-500/10 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-green-700">
              <Lock className="h-3 w-3" />
              {binding.threshold}/{binding.memberCount} bound
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-black/5 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-black/55">
              <ShieldCheck className="h-3 w-3" />
              Single signer
            </span>
          )
        }
      >
        {bindingLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-aperture-dark" />
          </div>
        ) : bindingError ? (
          <div className="rounded-[12px] border border-red-500/25 bg-red-500/5 p-3 text-[12px] text-red-700 tracking-tighter">
            {bindingError}
          </div>
        ) : binding ? (
          <MultisigOverviewCard
            binding={binding}
            walletAddress={walletAddress}
            onUpdate={(next) => setBinding(next)}
          />
        ) : operatorId ? (
          <MultisigBindingCard
            operatorId={operatorId}
            walletAddress={walletAddress}
            onBound={(next) => setBinding(next)}
          />
        ) : (
          <p className="text-[14px] text-black/55 tracking-tighter">
            Connect a wallet first to bind a multisig.
          </p>
        )}
      </SettingsSection>

      {/* Agent Stripe Configuration */}
      <AgentStripeCard operatorId={operatorId} />

      {/* API Configuration */}
      <SettingsSection
        icon={Server}
        title="API Configuration"
        description="Backend service URLs read at runtime. Override via NEXT_PUBLIC_* env to point at staging or prod."
      >
        <div className="grid grid-cols-1 gap-3">
          <CopyableField label="Policy Service" value={config.policyServiceUrl} />
          <CopyableField label="Compliance API" value={config.complianceApiUrl} />
          <CopyableField label="Prover Service" value={config.proverServiceUrl} />
          <CopyableField label="Solana RPC" value={config.solanaRpcUrl} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-black/55">
            Network
          </span>
          <span className="inline-flex items-center rounded-pill bg-aperture/12 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark">
            {config.solanaNetwork}
          </span>
        </div>
      </SettingsSection>

      {/* Operator Identity */}
      <SettingsSection
        icon={Settings}
        title="Operator Identity"
        description="Derived from your connected wallet address or session email. Used to scope every Aperture record."
      >
        {operatorId ? (
          <CopyableField
            label="Operator ID"
            value={operatorId}
            helper="Backend services namespace policies, proofs and attestations under this ID."
          />
        ) : (
          <p className="text-[14px] text-black/55 tracking-tighter">
            Connect a wallet or sign in to view your operator ID.
          </p>
        )}
      </SettingsSection>

      {/* On-chain Programs */}
      <SettingsSection
        icon={Cpu}
        title="On-chain Programs"
        description="Aperture's deployed Solana Devnet program IDs."
      >
        <div className="grid grid-cols-1 gap-3">
          {[
            { label: 'Policy Registry', id: config.programs.policyRegistry },
            { label: 'Verifier', id: config.programs.verifier },
            { label: 'Transfer Hook', id: config.programs.transferHook },
            { label: 'AIP Registry', id: config.programs.aipRegistry },
            { label: 'AIP Escrow', id: config.programs.aipEscrow },
            { label: 'Squads V4', id: 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf' },
          ].map((p) => (
            <CopyableField
              key={p.label}
              label={p.label}
              value={p.id}
              display={
                <a
                  href={config.explorerUrl(p.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
                >
                  {truncateAddress(p.id, 8)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              }
            />
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
