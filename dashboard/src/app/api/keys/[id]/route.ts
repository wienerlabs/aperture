import { NextRequest, NextResponse } from 'next/server';
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const res = await fetch(
    `${policyServiceUrl()}/api/v1/keys/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`,
    { method: 'DELETE', cache: 'no-store' },
  );
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
