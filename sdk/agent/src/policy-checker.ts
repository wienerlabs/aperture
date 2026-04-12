import type { Policy } from '@aperture/types';

interface CompiledPolicy {
  readonly policy_id: string;
  readonly operator_id: string;
  readonly max_daily_spend_lamports: string;
  readonly max_per_transaction_lamports: string;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly token_whitelist: readonly string[];
}

interface PaymentIntent {
  readonly amountLamports: number;
  readonly tokenMint: string;
  readonly recipient: string;
  readonly endpointCategory: string;
}

interface PolicyCheckResult {
  readonly passed: boolean;
  readonly violations: readonly string[];
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Aperture Agent] ${msg}`);
}

export class PolicyChecker {
  private readonly policyServiceUrl: string;
  private policy: Policy | null = null;
  private compiled: CompiledPolicy | null = null;
  private dailySpentLamports = 0;

  constructor(policyServiceUrl: string) {
    this.policyServiceUrl = policyServiceUrl;
  }

  async loadPolicy(operatorId: string): Promise<Policy> {
    log('Loading policy from policy service...');

    const listRes = await fetch(
      `${this.policyServiceUrl}/api/v1/policies/operator/${operatorId}?page=1&limit=1`,
    );
    if (!listRes.ok) {
      throw new Error(`Failed to fetch policies: HTTP ${listRes.status}`);
    }

    const listBody = (await listRes.json()) as {
      success: boolean;
      data: Policy[];
    };
    if (!listBody.success || listBody.data.length === 0) {
      throw new Error(
        'No active policies found for this operator. Create a policy first.',
      );
    }

    this.policy = listBody.data[0];

    log(
      `Policy loaded: "${this.policy.name}" -- max_daily=${this.policy.max_daily_spend} USDC, max_per_tx=${this.policy.max_per_transaction} USDC`,
    );

    // Compile for prover circuit
    const compileRes = await fetch(
      `${this.policyServiceUrl}/api/v1/policies/${this.policy.id}/compile`,
    );
    if (!compileRes.ok) {
      throw new Error(`Failed to compile policy: HTTP ${compileRes.status}`);
    }

    const compileBody = (await compileRes.json()) as {
      success: boolean;
      data: CompiledPolicy;
    };
    if (!compileBody.success) {
      throw new Error('Policy compilation failed');
    }

    this.compiled = compileBody.data;
    log('Policy compiled for ZK circuit');

    return this.policy;
  }

  checkPayment(intent: PaymentIntent): PolicyCheckResult {
    if (!this.policy) {
      return { passed: false, violations: ['No policy loaded'] };
    }

    log('Checking policy compliance...');
    const violations: string[] = [];

    // Max per transaction
    const maxPerTxLamports = this.policy.max_per_transaction * 1_000_000;
    if (intent.amountLamports > maxPerTxLamports) {
      violations.push(
        `Amount ${intent.amountLamports} exceeds max_per_transaction ${maxPerTxLamports}`,
      );
    }

    // Max daily spend
    const maxDailyLamports = this.policy.max_daily_spend * 1_000_000;
    if (this.dailySpentLamports + intent.amountLamports > maxDailyLamports) {
      violations.push(
        `Daily spend would exceed limit: ${this.dailySpentLamports + intent.amountLamports} > ${maxDailyLamports}`,
      );
    }

    // Endpoint category
    if (
      !this.policy.allowed_endpoint_categories.includes(
        intent.endpointCategory,
      )
    ) {
      violations.push(
        `Endpoint category "${intent.endpointCategory}" not allowed. Allowed: ${this.policy.allowed_endpoint_categories.join(', ')}`,
      );
    }

    // Blocked addresses
    if (this.policy.blocked_addresses.includes(intent.recipient)) {
      violations.push(`Recipient ${intent.recipient} is blocked`);
    }

    // Token whitelist
    if (!this.policy.token_whitelist.includes(intent.tokenMint)) {
      violations.push(
        `Token ${intent.tokenMint} not in whitelist: ${this.policy.token_whitelist.join(', ')}`,
      );
    }

    if (violations.length > 0) {
      log(`Policy check FAILED: ${violations.join('; ')}`);
      return { passed: false, violations };
    }

    log('Policy check passed');
    return { passed: true, violations: [] };
  }

  recordSpend(amountLamports: number): void {
    this.dailySpentLamports += amountLamports;
  }

  getPolicy(): Policy | null {
    return this.policy;
  }

  getCompiled(): CompiledPolicy | null {
    return this.compiled;
  }

  getDailySpent(): number {
    return this.dailySpentLamports;
  }
}
