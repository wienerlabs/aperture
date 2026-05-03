'use client';

import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  Settings,
  Wallet,
  Users,
  Server,
  CheckCircle,
  LogOut,
  Loader2,
  ExternalLink,
  Plus,
  Cpu,
} from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { config } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';
import { Keypair, PublicKey } from '@solana/web3.js';
import { AgentStripeCard } from './AgentStripeCard';
import { SettingsSection } from './shared/SettingsSection';
import { CopyableField } from './shared/CopyableField';

interface MultisigInfo {
  readonly address: string;
  readonly threshold: number;
  readonly memberCount: number;
  readonly createKey: string;
}

export function SettingsTab() {
  const { publicKey, disconnect, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const operatorId = useOperatorId();

  const [creatingMultisig, setCreatingMultisig] = useState(false);
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [multisigError, setMultisigError] = useState<string | null>(null);
  const [multisigTxSig, setMultisigTxSig] = useState<string | null>(null);

  const walletAddress = publicKey?.toBase58() ?? null;

  const checkExistingMultisig = useCallback(async () => {
    if (!publicKey) return;
    try {
      const sqds = await import('@sqds/multisig');

      // Check localStorage for previously created multisig
      const storedKey = localStorage.getItem(
        `aperture_multisig_createkey_${publicKey.toBase58()}`,
      );
      if (!storedKey) return;

      const createKeyPubkey = new PublicKey(storedKey);
      const [multisigPda] = sqds.getMultisigPda({
        createKey: createKeyPubkey,
      });

      const multisigAccount = await sqds.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda,
      );

      setMultisigInfo({
        address: multisigPda.toBase58(),
        threshold: multisigAccount.threshold,
        memberCount: multisigAccount.members.length,
        createKey: storedKey,
      });
    } catch {
      // No existing multisig found or error fetching
    }
  }, [publicKey, connection]);

  useEffect(() => {
    checkExistingMultisig();
  }, [checkExistingMultisig]);

  async function createMultisig(): Promise<void> {
    if (!publicKey || !signTransaction) return;

    setCreatingMultisig(true);
    setMultisigError(null);
    setMultisigTxSig(null);

    try {
      const sqds = await import('@sqds/multisig');
      const Permissions = sqds.types.Permissions;

      // Generate a new keypair for multisig creation (used as seed)
      const createKey = Keypair.generate();

      // Derive the multisig PDA
      const [multisigPda] = sqds.getMultisigPda({
        createKey: createKey.publicKey,
      });

      // Build the create multisig transaction. Threshold 1/1 for the demo
      // — operators can re-create with a higher threshold once they have
      // multiple signers ready to add.
      const [programConfigPda] = sqds.getProgramConfigPda({});
      const programConfig = await sqds.accounts.ProgramConfig.fromAccountAddress(
        connection,
        programConfigPda,
      );

      const createMultisigIx = sqds.instructions.multisigCreateV2({
        createKey: createKey.publicKey,
        creator: publicKey,
        multisigPda,
        configAuthority: publicKey,
        threshold: 1,
        members: [
          {
            key: publicKey,
            permissions: Permissions.all(),
          },
        ],
        timeLock: 0,
        treasury: programConfig.treasury,
        rentCollector: publicKey,
      });

      const { Transaction } = await import('@solana/web3.js');
      const tx = new Transaction().add(createMultisigIx);
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      // createKey must also sign
      tx.partialSign(createKey);

      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, 'confirmed');

      setMultisigTxSig(sig);

      // Store createKey in localStorage for future lookups
      localStorage.setItem(
        `aperture_multisig_createkey_${publicKey.toBase58()}`,
        createKey.publicKey.toBase58(),
      );

      setMultisigInfo({
        address: multisigPda.toBase58(),
        threshold: 1,
        memberCount: 1,
        createKey: createKey.publicKey.toBase58(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create multisig';
      setMultisigError(message);
    } finally {
      setCreatingMultisig(false);
    }
  }

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
            backend service URLs all live in one place — no admin console required.
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

      {/* Squads Multisig */}
      <SettingsSection
        icon={Users}
        title="Squads Multisig"
        description="Squads V4 enables multi-signature approval for policy changes. Policy registration and updates can be routed through the multisig for added security."
        action={
          multisigInfo ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-green-500/10 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-green-700">
              <CheckCircle className="h-3 w-3" />
              Active · {multisigInfo.threshold}/{multisigInfo.memberCount}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-pill bg-black/5 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-black/55">
              Not configured
            </span>
          )
        }
      >
        {multisigInfo ? (
          <>
            <CopyableField label="Multisig address" value={multisigInfo.address} />
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={config.explorerUrl(multisigInfo.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-aperture-dark hover:border-aperture/40 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View on Solana
              </a>
              {multisigTxSig && (
                <a
                  href={config.txExplorerUrl(multisigTxSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] tracking-tighter text-black/55 hover:text-black transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Creation tx
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            {multisigError && (
              <div className="rounded-[12px] border border-red-500/25 bg-red-500/5 p-3 text-[12px] text-red-700 tracking-tighter">
                {multisigError}
              </div>
            )}
            <button
              onClick={createMultisig}
              disabled={creatingMultisig || !connected}
              className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed w-fit"
            >
              {creatingMultisig ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {creatingMultisig ? 'Creating…' : 'Create Multisig'}
            </button>
            <p className="text-[12px] text-black/55 tracking-tighter">
              Creates a Squads V4 multisig on Devnet with 1/1 threshold. Your connected
              wallet will be the sole member; raise the threshold once additional
              signers are ready.
            </p>
          </>
        )}
      </SettingsSection>

      {/* Agent Stripe Configuration — kept as its own component, theming
          updates land via globals.css overrides. */}
      <AgentStripeCard operatorId={operatorId} />

      {/* API Configuration */}
      <SettingsSection
        icon={Server}
        title="API Configuration"
        description="Backend service URLs read at runtime. Override via NEXT_PUBLIC_* env to point at staging/prod."
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
