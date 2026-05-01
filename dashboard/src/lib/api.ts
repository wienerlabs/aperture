import { config } from './config';

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
  error: null;
}

async function request<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const policyApi = {
  list: (operatorId: string, page = 1, limit = 20) =>
    request<PaginatedResponse<Policy>>(
      config.policyServiceUrl,
      `/api/v1/policies/operator/${operatorId}?page=${page}&limit=${limit}`
    ),
  get: (id: string) =>
    request<ApiResponse<Policy>>(config.policyServiceUrl, `/api/v1/policies/${id}`),
  create: (data: PolicyInput) =>
    request<ApiResponse<Policy>>(config.policyServiceUrl, '/api/v1/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<PolicyInput>) =>
    request<ApiResponse<Policy>>(config.policyServiceUrl, `/api/v1/policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<ApiResponse<{ deleted: boolean }>>(config.policyServiceUrl, `/api/v1/policies/${id}`, {
      method: 'DELETE',
    }),
  compile: (id: string) =>
    request<ApiResponse<CompiledPolicy>>(config.policyServiceUrl, `/api/v1/policies/${id}/compile`),
  // The dashboard fetches the canonical on-chain payload from the
  // policy-service and signs it with the connected wallet. The legacy
  // POST /api/v1/onchain/register endpoint, which accepted a base58 keypair
  // in the body, is gone — there is no path that ever takes a private key.
  getOnchainPayload: (policyId: string) =>
    request<ApiResponse<OnchainPayload>>(
      config.policyServiceUrl,
      `/api/v1/policies/${policyId}/onchain-payload`
    ),
  confirmOnchain: (policyId: string, body: OnchainConfirmationBody) =>
    request<ApiResponse<Policy>>(
      config.policyServiceUrl,
      `/api/v1/policies/${policyId}/onchain-confirmation`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    ),
};

export const complianceApi = {
  submitProof: (data: ProofRecordInput) =>
    request<ApiResponse<ProofRecord>>(config.complianceApiUrl, '/api/v1/proofs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getProof: (id: string) =>
    request<ApiResponse<ProofRecord>>(config.complianceApiUrl, `/api/v1/proofs/${id}`),
  listProofsByOperator: (operatorId: string, page = 1, limit = 50) =>
    request<PaginatedResponse<ProofRecord>>(
      config.complianceApiUrl,
      `/api/v1/proofs/operator/${operatorId}?page=${page}&limit=${limit}`
    ),
  getProofByPayment: (paymentId: string) =>
    request<ApiResponse<ProofRecord>>(config.complianceApiUrl, `/api/v1/proofs/payment/${paymentId}`),
  updateProofTxSignature: (id: string, txSignature: string) =>
    request<ApiResponse<ProofRecord>>(config.complianceApiUrl, `/api/v1/proofs/${id}/tx-signature`, {
      method: 'PATCH',
      body: JSON.stringify({ tx_signature: txSignature }),
    }),
  createBatchAttestation: (data: { operator_id: string; period_start: string; period_end: string }) =>
    request<ApiResponse<BatchAttestationOutput>>(config.complianceApiUrl, '/api/v1/attestations/batch', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getAttestation: (id: string) =>
    request<ApiResponse<Attestation>>(config.complianceApiUrl, `/api/v1/attestations/${id}`),
  listAttestations: (operatorId: string, page = 1, limit = 20) =>
    request<PaginatedResponse<Attestation>>(
      config.complianceApiUrl,
      `/api/v1/attestations/operator/${operatorId}?page=${page}&limit=${limit}`
    ),
  getAttestationOutput: (id: string) =>
    request<ApiResponse<BatchAttestationOutput>>(config.complianceApiUrl, `/api/v1/attestations/${id}/output`),
  updateTxSignature: (id: string, txSignature: string) =>
    request<ApiResponse<Attestation>>(config.complianceApiUrl, `/api/v1/attestations/${id}/tx-signature`, {
      method: 'PATCH',
      body: JSON.stringify({ tx_signature: txSignature }),
    }),
  compressAttestation: (proofId: string, recipient: string) =>
    request<ApiResponse<{ tx_signature: string; proof_id: string; mint: string; recipient: string }>>(
      config.complianceApiUrl,
      '/api/v1/compliance/compress-attestation',
      {
        method: 'POST',
        body: JSON.stringify({ proof_id: proofId, recipient }),
      }
    ),
  getLightStatus: () =>
    request<ApiResponse<{ configured: boolean; rpc_url: string | null; compressed_mint: string | null }>>(
      config.complianceApiUrl,
      '/api/v1/compliance/light-status'
    ),
};

export type OnChainStatus = 'pending' | 'registered' | 'failed';

export interface Policy {
  id: string;
  operator_id: string;
  name: string;
  description: string | null;
  max_daily_spend: number;
  max_per_transaction: number;
  allowed_endpoint_categories: string[];
  blocked_addresses: string[];
  time_restrictions: TimeRestriction[];
  token_whitelist: string[];
  is_active: boolean;
  version: number;
  aip_agent_did: string | null;
  created_at: string;
  updated_at: string;
  merkle_root_hex: string | null;
  policy_data_hash_hex: string | null;
  onchain_pda: string | null;
  onchain_tx_signature: string | null;
  onchain_status: OnChainStatus;
  onchain_registered_at: string | null;
  onchain_last_error: string | null;
  onchain_version: number | null;
}

export interface OnchainPayload {
  policy_id: string;
  policy_id_bytes_hex: string;
  merkle_root_hex: string;
  policy_data_hash_hex: string;
  version: number;
  operator_id: string;
  onchain_status: OnChainStatus;
  onchain_pda: string | null;
  onchain_version: number | null;
  operation: 'register' | 'update' | 'noop';
}

export type OnchainConfirmationBody =
  | {
      status: 'registered';
      tx_signature: string;
      onchain_pda: string;
      onchain_version: number;
      merkle_root_hex: string;
      policy_data_hash_hex: string;
    }
  | {
      status: 'failed';
      error_message: string;
    };

export interface TimeRestriction {
  allowed_days: string[];
  allowed_hours_start: number;
  allowed_hours_end: number;
  timezone: string;
}

export interface PolicyInput {
  operator_id: string;
  name: string;
  description?: string;
  max_daily_spend: number;
  max_per_transaction: number;
  allowed_endpoint_categories: string[];
  blocked_addresses: string[];
  time_restrictions: TimeRestriction[];
  token_whitelist: string[];
  is_active?: boolean;
  aip_agent_did?: string;
}

export interface CompiledPolicy {
  policy_id: string;
  operator_id: string;
  max_daily_spend_lamports: string;
  max_per_transaction_lamports: string;
  allowed_endpoint_categories: string[];
  blocked_addresses: string[];
  time_restrictions: TimeRestriction[];
  token_whitelist: string[];
  version: number;
  compiled_at: string;
}

export interface ProofRecord {
  id: string;
  operator_id: string;
  policy_id: string;
  payment_id: string;
  proof_hash: string;
  amount_range_min: number;
  amount_range_max: number;
  token_mint: string;
  is_compliant: boolean;
  tx_signature: string | null;
  compressed_tx_signature: string | null;
  verified_at: string;
  created_at: string;
}

export interface ProofRecordInput {
  operator_id: string;
  policy_id: string;
  payment_id: string;
  proof_hash: string;
  amount_range_min: number;
  amount_range_max: number;
  token_mint: string;
  is_compliant: boolean;
  verified_at: string;
}

export interface Attestation {
  id: string;
  operator_id: string;
  period_start: string;
  period_end: string;
  total_payments: number;
  total_amount_range_min: number;
  total_amount_range_max: number;
  policy_violations: number;
  sanctions_intersections: number;
  proof_hashes: string[];
  batch_proof_hash: string;
  tx_signature: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface BatchAttestationOutput {
  id: string;
  operator_id: string;
  period_start: string;
  period_end: string;
  total_payments: number;
  total_amount_range: { min: number; max: number };
  policy_violations: 0;
  sanctions_intersections: 0;
  proof_hash: string;
}

export interface AIPAgentCapability {
  id: string;
  description: string;
  pricing: { amount: string; token: string; network: string };
}

export interface AIPAgent {
  authority: string;
  agentId: string;
  did: string;
  name: string;
  endpoint: string;
  capabilities: AIPAgentCapability[];
  version: string;
  publicKey: string;
}

export const aipApi = {
  listAgents: () =>
    request<{ success: boolean; data: AIPAgent[]; total: number }>(
      '',
      '/api/aip/agents'
    ),
};
