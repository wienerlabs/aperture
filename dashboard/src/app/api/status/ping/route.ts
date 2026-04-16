import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface TargetConfig {
  readonly name: string;
  readonly category: 'service' | 'rpc';
  readonly url: string | undefined;
  readonly kind: 'http_get' | 'solana_rpc' | 'helius_rpc';
  readonly timeoutMs: number;
}

type Status = 'operational' | 'degraded' | 'down' | 'unconfigured';

interface Probe {
  readonly name: string;
  readonly category: TargetConfig['category'];
  readonly status: Status;
  readonly latencyMs: number | null;
  readonly message: string | null;
  readonly checkedAt: string;
}

function envUrl(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildTargets(): readonly TargetConfig[] {
  return [
    {
      name: 'Policy Service',
      category: 'service',
      url: envUrl('POLICY_SERVICE_URL') ?? envUrl('NEXT_PUBLIC_POLICY_SERVICE_URL'),
      kind: 'http_get',
      timeoutMs: 4000,
    },
    {
      name: 'Compliance API',
      category: 'service',
      url: envUrl('COMPLIANCE_API_URL') ?? envUrl('NEXT_PUBLIC_COMPLIANCE_API_URL'),
      kind: 'http_get',
      timeoutMs: 4000,
    },
    {
      name: 'Prover Service',
      category: 'service',
      url: envUrl('PROVER_SERVICE_URL') ?? envUrl('NEXT_PUBLIC_PROVER_SERVICE_URL'),
      kind: 'http_get',
      timeoutMs: 4000,
    },
    {
      name: 'Agent Service',
      category: 'service',
      url: envUrl('AGENT_SERVICE_URL') ?? envUrl('NEXT_PUBLIC_AGENT_SERVICE_URL'),
      kind: 'http_get',
      timeoutMs: 4000,
    },
    {
      name: 'Solana Devnet RPC',
      category: 'rpc',
      url: envUrl('SOLANA_RPC_URL') ?? envUrl('NEXT_PUBLIC_SOLANA_RPC_URL'),
      kind: 'solana_rpc',
      timeoutMs: 5000,
    },
    {
      name: 'Helius RPC',
      category: 'rpc',
      url: envUrl('LIGHT_RPC_URL') ?? envUrl('NEXT_PUBLIC_LIGHT_RPC_URL'),
      kind: 'helius_rpc',
      timeoutMs: 5000,
    },
  ];
}

async function probeHttpGet(baseUrl: string, timeoutMs: number): Promise<{ ok: boolean; latencyMs: number; message: string | null }> {
  const healthUrl = baseUrl.replace(/\/$/, '') + '/health';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: controller.signal, cache: 'no-store' });
    const latency = Date.now() - startedAt;
    if (!res.ok) {
      return { ok: false, latencyMs: latency, message: `HTTP ${res.status}` };
    }
    return { ok: true, latencyMs: latency, message: null };
  } catch (err: unknown) {
    const latency = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : 'request failed';
    return { ok: false, latencyMs: latency, message };
  } finally {
    clearTimeout(timer);
  }
}

async function probeJsonRpc(rpcUrl: string, method: string, params: unknown[], timeoutMs: number): Promise<{ ok: boolean; latencyMs: number; message: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const latency = Date.now() - startedAt;
    if (!res.ok) {
      return { ok: false, latencyMs: latency, message: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) {
      return { ok: false, latencyMs: latency, message: body.error.message ?? 'RPC error' };
    }
    return { ok: true, latencyMs: latency, message: null };
  } catch (err: unknown) {
    const latency = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : 'request failed';
    return { ok: false, latencyMs: latency, message };
  } finally {
    clearTimeout(timer);
  }
}

function classify(latencyMs: number, ok: boolean): Status {
  if (!ok) return 'down';
  if (latencyMs > 2000) return 'degraded';
  return 'operational';
}

async function probeTarget(target: TargetConfig): Promise<Probe> {
  const checkedAt = new Date().toISOString();
  if (!target.url) {
    return { name: target.name, category: target.category, status: 'unconfigured', latencyMs: null, message: 'URL not configured', checkedAt };
  }

  let result: { ok: boolean; latencyMs: number; message: string | null };
  if (target.kind === 'http_get') {
    result = await probeHttpGet(target.url, target.timeoutMs);
  } else if (target.kind === 'solana_rpc') {
    result = await probeJsonRpc(target.url, 'getHealth', [], target.timeoutMs);
  } else {
    result = await probeJsonRpc(target.url, 'getHealth', [], target.timeoutMs);
  }

  return {
    name: target.name,
    category: target.category,
    status: classify(result.latencyMs, result.ok),
    latencyMs: result.latencyMs,
    message: result.message,
    checkedAt,
  };
}

export async function GET(): Promise<NextResponse> {
  const targets = buildTargets();
  const probes = await Promise.all(targets.map(probeTarget));
  const configured = probes.filter((p) => p.status !== 'unconfigured');
  const anyDown = configured.some((p) => p.status === 'down');
  const anyDegraded = configured.some((p) => p.status === 'degraded');
  const overall: Status = anyDown ? 'down' : anyDegraded ? 'degraded' : 'operational';
  return NextResponse.json({ overall, probes, generatedAt: new Date().toISOString() });
}
