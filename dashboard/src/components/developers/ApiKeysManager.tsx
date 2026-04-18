'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Copy, Check, Trash2, Loader2, KeyRound, AlertTriangle } from 'lucide-react';

interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly masked_key: string;
  readonly last_used_at: string | null;
  readonly created_at: string;
}

interface ApiKeyCreated extends ApiKeySummary {
  readonly full_key: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function CopyInline({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
      className={`inline-flex items-center gap-1 text-[11px] font-mono text-amber-400/75 hover:text-amber-400 transition-colors ${className}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function ApiKeysManager() {
  const { status } = useSession();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<ApiKeyCreated | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/keys', { cache: 'no-store' });
      if (res.status === 401) {
        setKeys(null);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { data?: ApiKeySummary[] };
      setKeys(body.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchKeys();
    }
  }, [status, fetchKeys]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: ApiKeyCreated; error?: string };
      if (!res.ok || !body.data) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setJustCreated(body.data);
      setName('');
      fetchKeys();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      fetchKeys();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setRevokingId(null);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-amber-400/75 text-sm font-mono">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking session…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-5 py-5 flex items-start gap-3">
        <KeyRound className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-mono text-sm font-semibold text-amber-200">Sign in to manage API keys</p>
          <p className="text-xs text-amber-400/75 mt-1">
            API keys are tied to your Aperture account. <a href="/auth/signin" className="underline hover:text-amber-400">Sign in</a> or <a href="/auth/signin" className="underline hover:text-amber-400">create an account</a> to continue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {justCreated && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-start gap-3 mb-3">
            <KeyRound className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-mono text-sm font-semibold text-emerald-300">API key created</p>
              <p className="text-xs text-emerald-300/60 mt-1">
                Copy this key now — the full value will not be shown again. If you lose it, revoke and generate a new one.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-[#0a0a0a] border border-amber-400/10 rounded px-3 py-2 font-mono text-xs text-amber-200 break-all">
            <span className="flex-1 select-all">{justCreated.full_key}</span>
            <CopyInline text={justCreated.full_key} />
          </div>
          <button
            type="button"
            onClick={() => setJustCreated(null)}
            className="mt-3 text-[11px] font-mono text-amber-400/70 hover:text-amber-400"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleCreate} className="rounded-lg border border-amber-400/10 p-5">
        <label className="block font-mono text-xs uppercase tracking-wider text-amber-400/70 mb-2">
          Generate new key
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. local-dev-laptop"
            className="flex-1 bg-[#0a0a0a] border border-amber-400/20 rounded px-3 py-2 text-sm font-mono text-amber-100 placeholder:text-amber-400/50 focus:outline-none focus:border-amber-400/60"
          />
          <button
            type="submit"
            disabled={creating || name.trim().length === 0}
            className="font-mono text-sm px-5 py-2 bg-amber-400 text-black rounded font-semibold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? 'Generating…' : 'Generate key'}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-red-300">{error}</p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-mono text-xs uppercase tracking-wider text-amber-400/70">Your keys</h3>
          {loading && <Loader2 className="w-4 h-4 text-amber-400/60 animate-spin" />}
        </div>
        {!loading && (!keys || keys.length === 0) && (
          <p className="font-mono text-xs text-amber-400/60">No keys yet. Generate one above to authenticate programmatic access.</p>
        )}
        <div className="space-y-2">
          {(keys ?? []).map((key) => (
            <div key={key.id} className="flex items-center justify-between gap-4 rounded-lg border border-amber-400/10 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-amber-100 truncate">{key.name}</p>
                <p className="font-mono text-[11px] text-amber-400/70 mt-0.5 truncate">
                  {key.masked_key}
                </p>
                <p className="font-mono text-[10px] text-amber-400/60 mt-1">
                  Created {formatDate(key.created_at)}
                  {key.last_used_at ? ` · Last used ${formatDate(key.last_used_at)}` : ' · Never used'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRevoke(key.id)}
                disabled={revokingId === key.id}
                className="flex-shrink-0 inline-flex items-center gap-1 font-mono text-xs px-3 py-1.5 border border-red-500/30 text-red-300 rounded hover:bg-red-500/10 disabled:opacity-40 transition-colors"
              >
                {revokingId === key.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Revoke
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
