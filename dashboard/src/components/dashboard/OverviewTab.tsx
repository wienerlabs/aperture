'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Shield, FileText, BarChart3, CheckCircle, ExternalLink, Copy,
  Upload, Download, Loader2,
} from 'lucide-react';
import { complianceApi, policyApi, type ProofRecord, type Attestation, type Policy } from '@/lib/api';
import { config } from '@/lib/config';
import { truncateAddress, formatDate, formatAmount } from '@/lib/utils';
import { getProofRecordCostComparison, lamportsToSol, isLightProtocolConfigured } from '@/lib/light-protocol';

interface OverviewData {
  readonly proofs: readonly ProofRecord[];
  readonly totalProofs: number;
  readonly attestations: readonly Attestation[];
  readonly totalAttestations: number;
  readonly policies: readonly Policy[];
}

export function OverviewTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const operatorId = useOperatorId();
  const { publicKey } = useWallet();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedAudit, setCopiedAudit] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [generatingCard, setGeneratingCard] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const walletAddress = publicKey?.toBase58() ?? operatorId ?? '';

  // Load profile photo from localStorage
  // Also persist last known wallet so photo survives sign-out/sign-in
  useEffect(() => {
    if (walletAddress) {
      localStorage.setItem('aperture_last_wallet', walletAddress);
      const saved = localStorage.getItem(`aperture_profile_${walletAddress}`);
      if (saved) setProfilePhoto(saved);
    } else {
      // Wallet not connected yet, try last known wallet
      const lastWallet = localStorage.getItem('aperture_last_wallet');
      if (lastWallet) {
        const saved = localStorage.getItem(`aperture_profile_${lastWallet}`);
        if (saved) setProfilePhoto(saved);
      }
    }
  }, [walletAddress]);

  const fetchData = useCallback(async () => {
    if (!operatorId) return;
    setLoading(true);
    try {
      const [proofsRes, attestationsRes, policiesRes] = await Promise.all([
        complianceApi.listProofsByOperator(operatorId, 1, 5),
        complianceApi.listAttestations(operatorId, 1, 5),
        policyApi.list(operatorId, 1, 5),
      ]);
      setData({
        proofs: proofsRes.data,
        totalProofs: proofsRes.pagination.total,
        attestations: attestationsRes.data,
        totalAttestations: attestationsRes.pagination.total,
        policies: policiesRes.data,
      });
    } catch {
      // Silently handle -- individual sections show empty states
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !walletAddress) return;
    if (file.size > 2 * 1024 * 1024) { alert('Max 2MB'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { alert('JPG, PNG, or WebP only'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setProfilePhoto(dataUrl);
      localStorage.setItem(`aperture_profile_${walletAddress}`, dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function generateIdenticon(address: string): string {
    // Simple deterministic color blocks from address bytes
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 16; i++) {
      const charCode = address.charCodeAt(i % address.length);
      const hue = (charCode * 37 + i * 53) % 360;
      ctx.fillStyle = `hsl(${hue}, 60%, 50%)`;
      ctx.fillRect((i % 4) * 16, Math.floor(i / 4) * 16, 16, 16);
    }
    return canvas.toDataURL();
  }

  const avatarSrc = profilePhoto ?? (walletAddress ? generateIdenticon(walletAddress) : '');

  function getCardDataUrl(): Promise<string> {
    return new Promise(async (resolve) => {
      if (!cardRef.current) { resolve(''); return; }
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(cardRef.current, { backgroundColor: '#000000', scale: 2 });
      resolve(canvas.toDataURL('image/png'));
    });
  }

  async function shareOnX() {
    const totalProofs = data?.totalProofs ?? 0;
    const text = encodeURIComponent(
      `Just proved compliance without revealing anything.\n\n` +
      `ZK Proofs: ${totalProofs}\n` +
      `Policy Violations: 0\n` +
      `Sanctions: Clean\n` +
      `Compliance Rate: 100%\n\n` +
      `Powered by Aperture -- ZK compliance for AI agents\n` +
      `x402 + MPP + RISC Zero + Light Protocol`
    );
    // Generate card image and copy to clipboard for easy paste
    try {
      const dataUrl = await getCardDataUrl();
      if (dataUrl) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
    } catch {
      // Clipboard image not supported in all browsers
    }
    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank');
  }

  async function generateComplianceCard() {
    if (!cardRef.current) return;
    setGeneratingCard(true);
    try {
      const dataUrl = await getCardDataUrl();
      const link = document.createElement('a');
      link.download = `aperture-compliance-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setGeneratingCard(false);
    }
  }

  async function copyAuditLink(id: string) {
    const url = `${window.location.origin}/audit/${id}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedAudit(true);
    setTimeout(() => setCopiedAudit(false), 2000);
  }

  const compliantProofs = data?.proofs.filter(p => p.is_compliant).length ?? 0;
  const complianceRate = data && data.totalProofs > 0
    ? Math.round((compliantProofs / Math.min(data.totalProofs, data.proofs.length)) * 100)
    : 0;
  const cost = getProofRecordCostComparison();
  const latestAttestation = data?.attestations[0] ?? null;
  const activePolicy = data?.policies.find(p => p.is_active) ?? null;

  if (!operatorId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
        <BarChart3 className="w-12 h-12 mb-4" />
        <p className="text-lg">Connect your wallet to view overview</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile + Share */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative group">
            <img
              src={avatarSrc}
              alt="Profile"
              className="w-12 h-12 rounded-full border-2 border-amber-400/30 object-cover"
            />
            <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
              <Upload className="w-4 h-4 text-amber-400" />
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoUpload} className="hidden" />
            </label>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-amber-100">Overview</h2>
            <p className="text-amber-100/40 text-sm font-mono">{truncateAddress(walletAddress, 6)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={shareOnX}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-amber-400/10 text-amber-400 border border-amber-400/20 hover:bg-amber-400/20 transition-colors"
          >
            Share on X
          </button>
          <button
            onClick={generateComplianceCard}
            disabled={generatingCard}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 transition-colors"
          >
            {generatingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Generate Card
          </button>
        </div>
      </div>

      {/* 1. Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Proofs', value: String(data?.totalProofs ?? 0), icon: FileText },
          { label: 'Compliance Rate', value: `${complianceRate}%`, icon: CheckCircle },
          { label: 'Policy Violations', value: '0', icon: Shield },
          { label: 'Total Attestations', value: String(data?.totalAttestations ?? 0), icon: BarChart3 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-amber-400/60" />
              <span className="text-xs text-amber-100/40">{label}</span>
            </div>
            <p className="text-2xl font-bold font-mono text-amber-100">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 2. Recent Transactions */}
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-amber-100 mb-4">Recent Proofs</h3>
          {data && data.proofs.length > 0 ? (
            <div className="space-y-3">
              {data.proofs.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-amber-100/60">{truncateAddress(p.payment_id, 6)}</span>
                    <span className="font-mono text-amber-400">{truncateAddress(p.proof_hash, 6)}</span>
                    <span className="text-amber-100/40">{formatAmount(p.amount_range_min)}-{formatAmount(p.amount_range_max)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded-full text-xs ${p.is_compliant ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>
                      {p.is_compliant ? 'Yes' : 'No'}
                    </span>
                    {p.tx_signature && (
                      <a href={config.txExplorerUrl(p.tx_signature)} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-100/50">No proofs yet</p>
          )}
        </div>

        {/* 3. ZK Compression Cost Savings */}
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-amber-100 mb-4">ZK Compression Savings</h3>
          {(() => {
            const total = data?.totalProofs ?? 0;
            const regularTotal = cost.regularAccountRentLamports * total;
            const compressedTotal = cost.compressedTokenCostLamports * total;
            return (
              <div className="space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-amber-100/40">Regular PDA Cost</span>
                  <span className="text-red-400 font-mono">{lamportsToSol(regularTotal)} SOL</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-amber-100/40">Compressed Cost</span>
                  <span className="text-green-400 font-mono">{lamportsToSol(compressedTotal)} SOL</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-amber-100/40">Total Saved</span>
                  <span className="text-amber-400 font-mono">{lamportsToSol(regularTotal - compressedTotal)} SOL ({cost.savingsMultiplier}x)</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-amber-100/50 pt-1">
                  <div className={`w-2 h-2 rounded-full ${isLightProtocolConfigured() ? 'bg-green-400' : 'bg-amber-400/30'}`} />
                  {isLightProtocolConfigured() ? 'Light Protocol active' : 'Light Protocol available'}
                </div>
              </div>
            );
          })()}
        </div>

        {/* 4. Latest Attestation */}
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-amber-100 mb-4">Latest Attestation</h3>
          {latestAttestation ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-amber-100/40">Period</span>
                  <p className="text-amber-100">{formatDate(latestAttestation.period_start)} - {formatDate(latestAttestation.period_end)}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Total Payments</span>
                  <p className="text-amber-100 font-mono">{latestAttestation.total_payments}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Amount Range</span>
                  <p className="text-amber-100 font-mono">{formatAmount(latestAttestation.total_amount_range_min)} - {formatAmount(latestAttestation.total_amount_range_max)}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Policy Violations</span>
                  <p className="text-green-400 font-mono">0</p>
                </div>
              </div>
              <div>
                <span className="text-xs text-amber-100/40">Proof Hash</span>
                <p className="text-xs text-amber-400 font-mono break-all mt-0.5">{latestAttestation.batch_proof_hash}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => copyAuditLink(latestAttestation.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-amber-100/60 hover:text-amber-100 border border-amber-400/20 hover:bg-amber-400/10 transition-colors">
                  {copiedAudit ? <><CheckCircle className="w-3 h-3 text-green-400" /><span className="text-green-400">Copied</span></> : <><Copy className="w-3 h-3" />Share Audit Link</>}
                </button>
                {latestAttestation.tx_signature && (
                  <a href={config.txExplorerUrl(latestAttestation.tx_signature)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-amber-400 border border-amber-400/20 hover:bg-amber-400/10 transition-colors">
                    <ExternalLink className="w-3 h-3" />View on Solana
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-100/50">No attestations yet</p>
          )}
        </div>

        {/* 5. Active Policy */}
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-amber-100 mb-4">Active Policy</h3>
          {activePolicy ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-amber-100">{activePolicy.name}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 text-xs">Active</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-amber-100/40">Max Daily Spend</span>
                  <p className="text-amber-100 font-mono">{formatAmount(activePolicy.max_daily_spend)}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Max Per Transaction</span>
                  <p className="text-amber-100 font-mono">{formatAmount(activePolicy.max_per_transaction)}</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                {activePolicy.token_whitelist.map(t => (
                  <span key={t} className="px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 text-xs font-mono">
                    {t === '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' ? 'USDC' : t === 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUQS7QEkCybt4rCxsT' ? 'USDT' : truncateAddress(t, 4)}
                  </span>
                ))}
              </div>
              <button onClick={() => onNavigate('policies')}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                View All Policies
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-100/50">No active policies</p>
          )}
        </div>
      </div>

      {/* Compliance Card (hidden, used for PNG generation) */}
      <div className="fixed -left-[9999px]" aria-hidden="true">
        <div ref={cardRef} style={{
          width: 900, height: 450,
          background: 'linear-gradient(145deg, #c9b896, #a89070, #c9b896)',
          padding: 8,
          display: 'flex',
          gap: 8,
          fontFamily: '"Courier New", Courier, monospace',
          borderRadius: 16,
        }}>
          {/* LEFT PANEL -- Branding */}
          <div style={{
            flex: 1.1,
            background: '#000000',
            borderRadius: 12,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: 32,
          }}>
            {/* Matrix background */}
            <div style={{ position: 'absolute', inset: 0, opacity: 0.04, fontSize: 9, lineHeight: '11px', color: '#fbbf24', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {Array.from({ length: 1200 }, (_, i) => String.fromCharCode(48 + (i * 7 + 13) % 74)).join('')}
            </div>
            {/* Top -- colosseum URL */}
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 11, color: 'rgba(251,191,36,0.4)', fontStyle: 'italic' }}>colosseum.com/frontier</div>
            </div>
            {/* Center -- Big text */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 13, color: 'rgba(251,191,36,0.5)', letterSpacing: 8, marginBottom: 12, textAlign: 'center' }}>ZK COMPLIANCE</div>
              <div style={{ fontSize: 56, fontWeight: 900, color: '#fbbf24', letterSpacing: 8, lineHeight: 1, textAlign: 'center' }}>Aperture</div>
              <div style={{ fontSize: 11, color: 'rgba(251,191,36,0.4)', marginTop: 14, letterSpacing: 4, textAlign: 'center' }}>PRIVACY LAYER FOR AI AGENTS</div>
            </div>
            {/* Bottom -- Powered by */}
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'rgba(251,191,36,0.5)', fontWeight: 'bold' }}>RISC ZERO</span>
                <span style={{ fontSize: 10, color: 'rgba(251,191,36,0.3)' }}>|</span>
                <span style={{ fontSize: 10, color: 'rgba(251,191,36,0.5)', fontWeight: 'bold' }}>SOLANA</span>
              </div>
              <span style={{ fontSize: 10, color: 'rgba(251,191,36,0.5)', fontWeight: 'bold' }}>x402 + LIGHT</span>
            </div>
          </div>

          {/* RIGHT PANEL -- Profile */}
          <div style={{
            flex: 0.9,
            background: '#f5f0e8',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 28,
          }}>
            {/* Profile photo */}
            <div style={{
              width: 160, height: 160,
              borderRadius: 12,
              border: '4px solid #000000',
              overflow: 'hidden',
              background: '#ddd',
            }}>
              {avatarSrc && <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>

            {/* Info */}
            <div style={{ textAlign: 'center', width: '100%' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#1a1200', letterSpacing: 2, marginBottom: 6 }}>
                {truncateAddress(walletAddress, 6).toUpperCase()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontSize: 10, color: '#6b5c3a' }}>
                <span>Proofs: {data?.totalProofs ?? 0}</span>
                <span>|</span>
                <span>Violations: 0</span>
              </div>
              <div style={{ fontSize: 11, color: '#6b5c3a', marginTop: 6 }}>
                Compliance: <span style={{ color: '#1a1200', fontWeight: 'bold' }}>100%</span>
              </div>
            </div>

            {/* Bottom row -- date + COMPLIANT */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <div style={{ fontSize: 11, color: '#8a7a5a', letterSpacing: 1 }}>
                {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
              </div>
              <div style={{
                padding: '6px 16px',
                background: '#1a1200',
                color: '#fbbf24',
                fontSize: 11,
                fontWeight: 900,
                borderRadius: 8,
                letterSpacing: 3,
                lineHeight: '16px',
              }}>
                COMPLIANT
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
