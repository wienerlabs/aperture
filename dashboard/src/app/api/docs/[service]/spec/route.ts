import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ServiceId = 'policy-service' | 'compliance-api' | 'prover-service' | 'agent-service';

function resolveBaseUrl(service: ServiceId): string | null {
  const envMap: Record<ServiceId, readonly string[]> = {
    'policy-service': ['POLICY_SERVICE_URL', 'NEXT_PUBLIC_POLICY_SERVICE_URL'],
    'compliance-api': ['COMPLIANCE_API_URL', 'NEXT_PUBLIC_COMPLIANCE_API_URL'],
    'prover-service': ['PROVER_SERVICE_URL', 'NEXT_PUBLIC_PROVER_SERVICE_URL'],
    'agent-service': ['AGENT_SERVICE_URL', 'NEXT_PUBLIC_AGENT_SERVICE_URL'],
  };
  for (const key of envMap[service]) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value.trim().replace(/\/$/, '');
  }
  return null;
}

function isServiceId(value: string): value is ServiceId {
  return value === 'policy-service' || value === 'compliance-api' || value === 'prover-service' || value === 'agent-service';
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ service: string }> }): Promise<NextResponse> {
  const { service } = await params;
  if (!isServiceId(service)) {
    return NextResponse.json({ error: `Unknown service: ${service}` }, { status: 404 });
  }
  const baseUrl = resolveBaseUrl(service);
  if (!baseUrl) {
    return NextResponse.json({ error: `Service URL not configured for ${service}` }, { status: 503 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const upstream = await fetch(`${baseUrl}/api-docs.json`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${service} returned HTTP ${upstream.status}` },
        { status: 502 },
      );
    }
    const spec = await upstream.json();
    return NextResponse.json(spec, {
      headers: {
        'cache-control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'upstream fetch failed';
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
