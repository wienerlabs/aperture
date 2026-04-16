import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './config';

const AIP_REGISTRY_PROGRAM = 'CgchXu2dRV3r9E1YjRhp4kbeLLtv1Xz61yoerJzp1Vbc';
const AGENT_DISCRIMINATOR = '04c98146c5862fa9';
const MAX_STRING_LENGTH = 10_000;

export interface AIPAgentCapability {
  readonly id: string;
  readonly description: string;
  readonly pricing: {
    readonly amount: string;
    readonly token: string;
    readonly network: string;
  };
}

export interface AIPAgent {
  readonly authority: string;
  readonly walletAddress: string;
  readonly agentId: string;
  readonly did: string;
  readonly name: string;
  readonly endpoint: string;
  readonly capabilities: readonly AIPAgentCapability[];
  readonly version: string;
  readonly publicKey: string;
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
function parseAgentAccount(data: Buffer, accountPubkey: string): AIPAgent | null {
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

    let capabilities: AIPAgentCapability[] = [];
    try {
      const parsed = JSON.parse(capabilitiesRaw.value);
      if (Array.isArray(parsed)) {
        capabilities = parsed.map((cap: Record<string, unknown>) => ({
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
      }
    } catch {
      // Non-JSON capabilities
    }

    return {
      authority,
      walletAddress,
      agentId: agentId.value,
      did: did.value,
      name: name.value,
      endpoint: endpoint.value,
      capabilities,
      version: version.value,
      publicKey: accountPubkey,
    };
  } catch {
    return null;
  }
}

export async function fetchAIPAgents(): Promise<readonly AIPAgent[]> {
  const connection = new Connection(config.solanaRpcUrl, 'confirmed');
  const programId = new PublicKey(AIP_REGISTRY_PROGRAM);

  const accounts = await connection.getProgramAccounts(programId);

  const agents: AIPAgent[] = [];
  const seenDids = new Set<string>();

  for (const account of accounts) {
    const data = Buffer.from(account.account.data);

    const discriminator = data.subarray(0, 8).toString('hex');
    if (discriminator !== AGENT_DISCRIMINATOR) continue;

    const agent = parseAgentAccount(data, account.pubkey.toBase58());
    if (agent && agent.name && !seenDids.has(agent.did)) {
      seenDids.add(agent.did);
      agents.push(agent);
    }
  }

  return agents;
}

export function isAgentReachable(endpoint: string): boolean {
  return !endpoint.includes('localhost') && !endpoint.includes('127.0.0.1');
}
