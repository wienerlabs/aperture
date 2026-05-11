'use client';

/**
 * MultisigAutoBindFlow — devnet one-shot binding. The operator clicks a
 * button, policy-service generates a fresh keypair, funds it from the
 * configured treasury, calls multisigCreateV2 + initialise_operator +
 * set_multisig, then mirrors the binding into Postgres. The component
 * walks the operator through the steps with animated progress and
 * surfaces the new operator authority + keypair download at the end so
 * nothing about the bind requires touching a terminal.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  KeyRound,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { multisigApi, type MultisigBinding } from '@/lib/api';
import { ApInput } from '../policies/ApField';
import { CopyableField } from '../shared/CopyableField';

interface MultisigAutoBindFlowProps {
  readonly onBound: (binding: MultisigBinding) => void;
}

type Phase = 'idle' | 'running' | 'done' | 'error';

interface AutoResult {
  readonly binding: MultisigBinding;
  readonly keypairBytes: readonly number[];
  readonly signatures: { readonly create: string; readonly bind: string };
}

const STEP_LABELS: ReadonlyArray<string> = [
  'Generating operator keypair',
  'Funding from devnet treasury',
  'Calling multisigCreateV2',
  'Initialising operator account',
  'Locking operator to vault PDA',
  'Caching binding in policy-service',
];

export function MultisigAutoBindFlow({
  onBound,
}: MultisigAutoBindFlowProps): JSX.Element {
  const [threshold, setThreshold] = useState(1);
  const [membersText, setMembersText] = useState('');
  const [label, setLabel] = useState('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutoResult | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  const extraMembers = useMemo<readonly string[]>(() => {
    return membersText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [membersText]);

  const totalMembers = 1 + extraMembers.length;
  const thresholdValid = threshold >= 1 && threshold <= totalMembers;

  async function handleRun(): Promise<void> {
    if (!thresholdValid) {
      setError(`Threshold ${threshold} cannot exceed ${totalMembers} member(s)`);
      return;
    }
    setPhase('running');
    setError(null);
    setActiveStep(0);

    // Animate the step indicator while the request runs. The server flow
    // takes ~10s end-to-end on devnet; cycling steps every 1.5s gives the
    // operator something to watch instead of a frozen spinner.
    const stepTimer = window.setInterval(() => {
      setActiveStep((prev) => Math.min(prev + 1, STEP_LABELS.length - 1));
    }, 1500);

    try {
      const res = await multisigApi.bindAutomated({
        threshold,
        extra_members: extraMembers.length > 0 ? extraMembers : undefined,
        label: label.trim() || undefined,
      });
      if (!res.data) throw new Error(res.error ?? 'Automated bind returned no data');
      window.clearInterval(stepTimer);
      setActiveStep(STEP_LABELS.length - 1);
      setResult(res.data);
      setPhase('done');
    } catch (err) {
      window.clearInterval(stepTimer);
      setError(err instanceof Error ? err.message : 'Automated bind failed');
      setPhase('error');
    }
  }

  function downloadKeypair(): void {
    if (!result) return;
    const json = JSON.stringify(result.keypairBytes);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aperture-operator-${result.binding.operatorId.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2 rounded-[14px] border border-aperture/30 bg-[rgba(248,179,0,0.06)] px-3 py-2.5">
        <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-aperture-dark" />
        <div className="text-[12px] text-black/65 tracking-tighter">
          <p>
            Devnet one-tap. policy-service generates a fresh operator authority,
            funds it from the configured treasury, creates a Squads V4 multisig,
            and binds it to your operator account — all in a single request.
          </p>
          <p className="mt-1 text-black/45">
            The new keypair is returned <strong>once</strong> so you can save it
            locally. No server-side custody.
          </p>
        </div>
      </div>

      <fieldset
        disabled={phase === 'running'}
        className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start"
      >
        <ApInput
          label="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Treasury 1-of-1"
          helper="Stored in the audit log so multisigs are easy to identify."
        />
        <ApInput
          label="Threshold"
          type="number"
          min={1}
          value={String(threshold)}
          onChange={(e) => {
            const n = Number(e.target.value);
            // Hard cap at 10 to keep the input sane; the actual validity
            // (threshold <= totalMembers) is enforced visually via helper +
            // the Run button being disabled. We deliberately do NOT pass
            // max={} on the input element because some browsers refuse
            // typing past it before co-signers are pasted, locking the
            // value at 1 even when the operator types 2.
            setThreshold(Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : 1);
          }}
          fieldClassName="sm:w-32"
          helper={`${threshold} of ${totalMembers}${
            thresholdValid ? '' : ' - add co-signers first'
          }`}
        />
      </fieldset>

      <div>
        <label className="text-[11px] uppercase tracking-[0.08em] text-black/55">
          Co-signers (optional, one pubkey per line)
        </label>
        <textarea
          value={membersText}
          onChange={(e) => setMembersText(e.target.value)}
          placeholder="CBDjvUkZZ6ucrVGrU3vRraasTytha8oVg2NLCxAHE25b"
          disabled={phase === 'running'}
          rows={3}
          className="mt-1.5 w-full px-3 py-2 bg-white border border-black/12 hover:border-aperture/40 focus:border-aperture transition-colors text-[12px] font-mono text-black resize-y outline-none"
        />
        <p className="mt-1 text-[12px] text-black/55 tracking-tighter">
          The freshly generated operator authority is always member [0]. Add up
          to 9 extra members.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {phase === 'idle' && (
          <motion.button
            key="run"
            type="button"
            onClick={handleRun}
            disabled={!thresholdValid}
            whileTap={{ scale: 0.97 }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="ap-btn-orange inline-flex items-center gap-2 self-start disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Wand2 className="h-4 w-4" />
            Create + bind automatically
          </motion.button>
        )}

        {phase === 'running' && (
          <motion.div
            key="running"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-[14px] border border-aperture/35 bg-[rgba(248,179,0,0.05)] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-4 w-4 animate-spin text-aperture-dark" />
              <span className="font-display text-[14px] tracking-[-0.005em] text-black">
                Binding multisig on Solana Devnet…
              </span>
            </div>
            <ol className="flex flex-col gap-1.5">
              {STEP_LABELS.map((stepLabel, i) => {
                const done = i < activeStep;
                const current = i === activeStep;
                return (
                  <li key={stepLabel} className="flex items-center gap-2">
                    <motion.span
                      animate={{
                        background: done
                          ? 'rgba(22,163,74,0.18)'
                          : current
                            ? 'rgba(248,179,0,0.18)'
                            : 'rgba(0,0,0,0.06)',
                        color: done ? '#16a34a' : current ? '#c98f00' : '#7c8293',
                        scale: current ? 1.02 : 1,
                      }}
                      transition={{ duration: 0.3 }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-pill text-[10px] font-mono"
                    >
                      {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                    </motion.span>
                    <span
                      className={`text-[12px] tracking-tighter ${
                        current
                          ? 'text-black font-medium'
                          : done
                            ? 'text-green-700'
                            : 'text-black/45'
                      }`}
                    >
                      {stepLabel}
                      {current && '…'}
                    </span>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}

        {phase === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-[14px] border border-red-500/30 bg-red-500/5 px-3 py-2.5"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
            <div className="flex-1">
              <p className="text-[12px] text-red-700 tracking-tighter break-all">
                {error}
              </p>
              <button
                type="button"
                onClick={() => {
                  setPhase('idle');
                  setError(null);
                }}
                className="mt-2 inline-flex items-center gap-1 rounded-pill border border-red-500/30 bg-white px-3 py-1 text-[11px] font-medium tracking-tighter text-red-700 hover:border-red-500/50 transition-colors"
              >
                Try again
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'done' && result && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-3 rounded-[16px] border border-green-500/30 bg-green-500/5 p-4"
          >
            <div className="flex items-center gap-2">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-pill bg-green-500/20 text-green-700"
              >
                <CheckCircle2 className="h-5 w-5" />
              </motion.span>
              <div>
                <p className="font-display text-[16px] tracking-[-0.005em] text-green-700">
                  Multisig bound on Devnet
                </p>
                <p className="text-[12px] text-black/55 tracking-tighter">
                  Save the operator keypair before reloading — it cannot be
                  recovered.
                </p>
              </div>
            </div>

            <CopyableField
              label="Operator authority"
              value={result.binding.operatorId}
            />
            <CopyableField
              label="Multisig PDA"
              value={result.binding.multisigAddress}
            />
            <CopyableField
              label={`Vault[${result.binding.vaultIndex}] PDA`}
              value={result.binding.vaultPda}
            />
            <CopyableField
              label="Bind tx signature"
              value={result.signatures.bind}
            />

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={downloadKeypair}
                className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-black hover:border-aperture/40 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download keypair JSON
              </button>
              <button
                type="button"
                onClick={() => onBound(result.binding)}
                className="ap-btn-orange inline-flex items-center gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Use this multisig
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
