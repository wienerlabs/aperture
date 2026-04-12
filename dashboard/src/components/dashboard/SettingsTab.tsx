'use client';

import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  Settings,
  Wallet,
  Users,
  Server,
  Copy,
  CheckCircle,
  LogOut,
  Loader2,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { config } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';
import { Keypair, PublicKey } from '@solana/web3.js';

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

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [creatingMultisig, setCreatingMultisig] = useState(false);
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [multisigError, setMultisigError] = useState<string | null>(null);
  const [multisigTxSig, setMultisigTxSig] = useState<string | null>(null);

  const walletAddress = publicKey?.toBase58() ?? null;

  async function copyToClipboard(text: string, field: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }

  const checkExistingMultisig = useCallback(async () => {
    if (!publicKey) return;
    try {
      const sqds = await import('@sqds/multisig');

      // Check localStorage for previously created multisig
      const storedKey = localStorage.getItem(`aperture_multisig_createkey_${publicKey.toBase58()}`);
      if (!storedKey) return;

      const createKeyPubkey = new PublicKey(storedKey);
      const [multisigPda] = sqds.getMultisigPda({
        createKey: createKeyPubkey,
      });

      const multisigAccount = await sqds.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda
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

      // Build the create multisig transaction
      // Threshold: 1/1 for demo
      // Squads program treasury (from on-chain ProgramConfig)
      const [programConfigPda] = sqds.getProgramConfigPda({});
      const programConfig = await sqds.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);

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
        createKey.publicKey.toBase58()
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
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-amber-100">Settings</h2>
        <p className="text-amber-100/40 text-sm mt-1">
          Manage your wallet, multisig, and API configuration
        </p>
      </div>

      {/* Wallet Connection */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Wallet className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-amber-100">Wallet Connection</h3>
        </div>

        {connected && walletAddress ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-amber-100/40 mb-1">
                Connected Wallet Address
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-amber-100 text-sm break-all">
                  {walletAddress}
                </span>
                <button
                  onClick={() => copyToClipboard(walletAddress, 'wallet')}
                  className="flex-shrink-0 text-amber-100/20 hover:text-amber-400 transition-colors"
                  aria-label="Copy wallet address"
                >
                  {copiedField === 'wallet' ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/10 text-amber-400 text-xs font-medium">
                <CheckCircle className="w-3 h-3" />
                Connected
              </span>
            </div>
            <button
              onClick={() => disconnect()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10 border border-red-400/20 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Disconnect Wallet
            </button>
          </div>
        ) : (
          <div className="text-amber-100/40">
            <p className="text-sm mb-3">No wallet connected.</p>
            <p className="text-xs">
              Connect a Solana wallet (Phantom, Solflare) using the wallet adapter
              to access full functionality.
            </p>
          </div>
        )}
      </div>

      {/* Squads Multisig */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Users className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-amber-100">Squads Multisig</h3>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-amber-100/60">
            Squads V4 multisig enables multi-signature approval for policy changes.
            Policy registration and updates can be routed through the multisig for added security.
          </p>

          {multisigInfo ? (
            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-amber-100/40">Status</span>
                    <p className="flex items-center gap-1.5 text-amber-400 font-medium">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Active
                    </p>
                  </div>
                  <div>
                    <span className="text-amber-100/40">Threshold</span>
                    <p className="text-amber-100 font-mono">
                      {multisigInfo.threshold}/{multisigInfo.memberCount}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-amber-100/40">Multisig Address</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-sm font-mono text-amber-100 break-all">
                        {multisigInfo.address}
                      </span>
                      <button
                        onClick={() => copyToClipboard(multisigInfo.address, 'multisig')}
                        className="flex-shrink-0 text-amber-100/20 hover:text-amber-400 transition-colors"
                        aria-label="Copy multisig address"
                      >
                        {copiedField === 'multisig' ? (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <a
                href={config.explorerUrl(multisigInfo.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on Solana Explorer
              </a>

              {multisigTxSig && (
                <a
                  href={config.txExplorerUrl(multisigTxSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-amber-100/40 hover:text-amber-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Creation transaction
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-amber-100/40">Status</span>
                  <p className="text-amber-100/60">Not configured</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Required Signers</span>
                  <p className="text-amber-100/60">-</p>
                </div>
              </div>

              {multisigError && (
                <div className="p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 text-sm">
                  {multisigError}
                </div>
              )}

              <button
                onClick={createMultisig}
                disabled={creatingMultisig || !connected}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-lg px-6 py-2 transition-colors"
              >
                {creatingMultisig ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {creatingMultisig ? 'Creating...' : 'Create Multisig'}
              </button>

              <p className="text-xs text-amber-100/30">
                Creates a Squads V4 multisig on Devnet with 1/1 threshold.
                Your connected wallet will be the sole member.
                Policy operations can then be routed through this multisig.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* API Configuration */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Server className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-amber-100">API Configuration</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Policy Service URL
            </label>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-amber-100 bg-amber-400/5 px-3 py-1.5 rounded-lg border border-amber-400/10 flex-1">
                {config.policyServiceUrl}
              </code>
              <button
                onClick={() => copyToClipboard(config.policyServiceUrl, 'policy-url')}
                className="flex-shrink-0 text-amber-100/20 hover:text-amber-400 transition-colors"
                aria-label="Copy policy service URL"
              >
                {copiedField === 'policy-url' ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Compliance API URL
            </label>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-amber-100 bg-amber-400/5 px-3 py-1.5 rounded-lg border border-amber-400/10 flex-1">
                {config.complianceApiUrl}
              </code>
              <button
                onClick={() => copyToClipboard(config.complianceApiUrl, 'compliance-url')}
                className="flex-shrink-0 text-amber-100/20 hover:text-amber-400 transition-colors"
                aria-label="Copy compliance API URL"
              >
                {copiedField === 'compliance-url' ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Prover Service URL
            </label>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-amber-100 bg-amber-400/5 px-3 py-1.5 rounded-lg border border-amber-400/10 flex-1">
                {config.proverServiceUrl}
              </code>
              <button
                onClick={() => copyToClipboard(config.proverServiceUrl, 'prover-url')}
                className="flex-shrink-0 text-amber-100/20 hover:text-amber-400 transition-colors"
                aria-label="Copy prover service URL"
              >
                {copiedField === 'prover-url' ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Solana RPC URL
            </label>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-amber-100 bg-amber-400/5 px-3 py-1.5 rounded-lg border border-amber-400/10 flex-1">
                {config.solanaRpcUrl}
              </code>
              <button
                onClick={() => copyToClipboard(config.solanaRpcUrl, 'rpc-url')}
                className="flex-shrink-0 text-amber-100/20 hover:text-amber-400 transition-colors"
                aria-label="Copy Solana RPC URL"
              >
                {copiedField === 'rpc-url' ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Solana Network
            </label>
            <span className="px-2.5 py-1 rounded-full bg-amber-400/10 text-amber-400 text-xs font-medium">
              {config.solanaNetwork}
            </span>
          </div>
        </div>
      </div>

      {/* Operator ID */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Settings className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-amber-100">Operator Identity</h3>
        </div>

        {operatorId ? (
          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Operator ID
            </label>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-amber-100 bg-amber-400/5 px-3 py-1.5 rounded-lg border border-amber-400/10 flex-1 break-all">
                {operatorId}
              </code>
              <button
                onClick={() => copyToClipboard(operatorId, 'operator-id')}
                className="flex-shrink-0 text-amber-100/20 hover:text-amber-400 transition-colors"
                aria-label="Copy operator ID"
              >
                {copiedField === 'operator-id' ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-amber-100/30 mt-2">
              This ID is derived from your connected wallet address or session email.
              It is used to identify your operator account across all Aperture services.
            </p>
          </div>
        ) : (
          <p className="text-sm text-amber-100/40">
            Connect a wallet or sign in to view your operator ID.
          </p>
        )}
      </div>

      {/* On-chain Programs */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Server className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-amber-100">On-chain Programs</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Policy Registry Program
            </label>
            <a
              href={config.explorerUrl(config.programs.policyRegistry)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-amber-400 hover:text-amber-300 transition-colors"
            >
              {truncateAddress(config.programs.policyRegistry, 8)}
            </a>
          </div>
          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Verifier Program
            </label>
            <a
              href={config.explorerUrl(config.programs.verifier)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-amber-400 hover:text-amber-300 transition-colors"
            >
              {truncateAddress(config.programs.verifier, 8)}
            </a>
          </div>
          <div>
            <label className="block text-sm text-amber-100/40 mb-1">
              Transfer Hook Program
            </label>
            <a
              href={config.explorerUrl(config.programs.transferHook)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-amber-400 hover:text-amber-300 transition-colors"
            >
              {truncateAddress(config.programs.transferHook, 8)}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
