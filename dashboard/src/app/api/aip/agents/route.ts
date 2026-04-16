import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

const AIP_REGISTRY_PROGRAM = 'CgchXu2dRV3r9E1YjRhp4kbeLLtv1Xz61yoerJzp1Vbc';
const AGENT_DISCRIMINATOR = '04c98146c5862fa9';
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const MAX_STRING_LENGTH = 10_000;

interface AgentCapability {
  id: string;
  description: string;
  pricing: { amount: string; token: string; network: string };
}

interface AgentData {
  authority: string;
  walletAddress: string;
  agentId: string;
  did: string;
  name: string;
  endpoint: string;
  capabilities: AgentCapability[];
  version: string;
  publicKey: string;
}

function readBorshString(
  data: Buffer,
  offset: number,
): { value: string; bytesRead: number } | null {
  if (offset + 4 > data.length) return null;
  const length = data.readUInt32LE(offset);
  if (length > MAX_STRING_LENGTH || offset + 4 + length > data.length) return null;
  const value = data.subarray(offset + 4, offset + 4 + length).toString('utf8');
  return { value, bytesRead: 4 + length };
}

function parseCapabilities(raw: string): AgentCapability[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((cap: Record<string, unknown>) => ({
      id: String(cap.id ?? ''),
      description: String(cap.description ?? ''),
      pricing: {
        amount: String(
          (cap.pricing as Record<string, unknown> | undefined)?.amount ?? cap.price ?? '0'
        ),
        token: String(
          (cap.pricing as Record<string, unknown> | undefined)?.token ?? 'USDC'
        ),
        network: String(
          (cap.pricing as Record<string, unknown> | undefined)?.network ?? 'solana'
        ),
      },
    }));
  } catch {
    return [];
  }
}

/**
 * AIP Registry account layout (Anchor Borsh):
 *   [0..8]    discriminator
 *   [8..40]   authority (Pubkey)
 *   [40..]    agent_id (String)
 *   [..]      did (String)
 *   [..]      name (String)
 *   [..]      endpoint (String)
 *   [..+32]   wallet_address (Pubkey)
 *   [..+1]    bump (u8)
 *   [..]      capabilities (String, JSON)
 *   [..]      version (String)
 */
function parseAgent(data: Buffer, pubkey: string): AgentData | null {
  try {
    let offset = 8;

    const authority = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;

    const agentId = readBorshString(data, offset);
    if (!agentId) return null;
    offset += agentId.bytesRead;

    const did = readBorshString(data, offset);
    if (!did) return null;
    offset += did.bytesRead;

    const name = readBorshString(data, offset);
    if (!name) return null;
    offset += name.bytesRead;

    const endpoint = readBorshString(data, offset);
    if (!endpoint) return null;
    offset += endpoint.bytesRead;

    // wallet_address (32 bytes) + bump (1 byte)
    if (offset + 33 > data.length) return null;
    const walletAddress = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 33;

    const capabilitiesRaw = readBorshString(data, offset);
    if (!capabilitiesRaw) return null;
    offset += capabilitiesRaw.bytesRead;

    const version = readBorshString(data, offset);
    if (!version) return null;

    return {
      authority,
      walletAddress,
      agentId: agentId.value,
      did: did.value,
      name: name.value,
      endpoint: endpoint.value,
      capabilities: parseCapabilities(capabilitiesRaw.value),
      version: version.value,
      publicKey: pubkey,
    };
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const programId = new PublicKey(AIP_REGISTRY_PROGRAM);

    const accounts = await connection.getProgramAccounts(programId);

    const agents: AgentData[] = [];
    const seenDids = new Set<string>();

    for (const account of accounts) {
      const data = Buffer.from(account.account.data);

      const discriminator = data.subarray(0, 8).toString('hex');
      if (discriminator !== AGENT_DISCRIMINATOR) continue;

      const agent = parseAgent(data, account.pubkey.toBase58());
      if (agent && agent.name && !seenDids.has(agent.did)) {
        seenDids.add(agent.did);
        agents.push(agent);
      }
    }

    return NextResponse.json({
      success: true,
      data: agents,
      total: agents.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch AIP agents';
    return NextResponse.json(
      { success: false, data: null, error: message },
      { status: 500 }
    );
  }
}
