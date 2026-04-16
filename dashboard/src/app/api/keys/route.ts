import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function policyServiceUrl(): string {
  const url = process.env.POLICY_SERVICE_URL ?? process.env.NEXT_PUBLIC_POLICY_SERVICE_URL;
  if (!url) throw new Error('POLICY_SERVICE_URL is not configured');
  return url.replace(/\/$/, '');
}

async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string } | undefined;
  return user?.id ?? null;
}

export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const res = await fetch(`${policyServiceUrl()}/api/v1/keys?user_id=${encodeURIComponent(userId)}`, {
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function POST(req: Request): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let payload: { name?: string };
  try {
    payload = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!payload.name || typeof payload.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const res = await fetch(`${policyServiceUrl()}/api/v1/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, name: payload.name }),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
