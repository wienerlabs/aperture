interface MPPChallenge {
  readonly id: string;
  readonly realm: string;
  readonly method: string;
  readonly intent: string;
  readonly expires: string;
  readonly request: {
    readonly amount: string;
    readonly currency: string;
    readonly description: string;
    readonly resource: string;
  };
  readonly stripe: {
    readonly paymentIntentId: string;
    readonly clientSecret: string;
  };
}

interface MPPCredential {
  readonly challengeId: string;
  readonly paymentIntentId: string;
}

export interface MPPPayResult {
  readonly success: boolean;
  readonly paymentIntentId: string | null;
  readonly data: unknown;
  readonly error: string | null;
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Aperture Agent] ${msg}`);
}

export class MPPPayer {
  private readonly complianceApiUrl: string;
  private readonly stripeSecretKey: string;

  constructor(complianceApiUrl: string, stripeSecretKey: string) {
    this.complianceApiUrl = complianceApiUrl;
    this.stripeSecretKey = stripeSecretKey;
  }

  async payForReport(operatorId: string): Promise<MPPPayResult> {
    const endpoint = `${this.complianceApiUrl}/api/v1/compliance/mpp-report?operator_id=${operatorId}`;

    log(`Paying via MPP: $0.50 -> /compliance/mpp-report`);

    // Step 1: GET -> 402
    const initialRes = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (initialRes.ok) {
      const body = (await initialRes.json()) as { data: unknown };
      return {
        success: true,
        paymentIntentId: null,
        data: body.data,
        error: null,
      };
    }

    if (initialRes.status !== 402) {
      const body = (await initialRes.json().catch(() => ({
        error: initialRes.statusText,
      }))) as { error?: string };
      return {
        success: false,
        paymentIntentId: null,
        data: null,
        error: body.error ?? `HTTP ${initialRes.status}`,
      };
    }

    // Step 2: Parse challenge
    const challengeBody = (await initialRes.json()) as {
      mppChallenge?: MPPChallenge;
    };
    const challenge = challengeBody.mppChallenge;

    if (!challenge) {
      return {
        success: false,
        paymentIntentId: null,
        data: null,
        error: 'Invalid 402 response: no mppChallenge',
      };
    }

    log(
      `  Challenge received: ${challenge.request.amount} ${challenge.request.currency.toUpperCase()} (PI: ${challenge.stripe.paymentIntentId})`,
    );

    // Step 3: Confirm PaymentIntent server-side via Stripe API
    const confirmRes = await fetch(
      `https://api.stripe.com/v1/payment_intents/${challenge.stripe.paymentIntentId}/confirm`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.stripeSecretKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'payment_method=pm_card_visa',
      },
    );

    if (!confirmRes.ok) {
      const errBody = (await confirmRes.json()) as {
        error?: { message?: string };
      };
      return {
        success: false,
        paymentIntentId: challenge.stripe.paymentIntentId,
        data: null,
        error: `Stripe confirm failed: ${errBody.error?.message ?? confirmRes.statusText}`,
      };
    }

    const pi = (await confirmRes.json()) as { id: string; status: string };
    if (pi.status !== 'succeeded') {
      return {
        success: false,
        paymentIntentId: pi.id,
        data: null,
        error: `Payment status: ${pi.status}`,
      };
    }

    log(`  Stripe payment confirmed: ${pi.id}`);

    // Step 4: Retry with credential
    const credential: MPPCredential = {
      challengeId: challenge.id,
      paymentIntentId: pi.id,
    };
    const encodedCredential = Buffer.from(JSON.stringify(credential)).toString(
      'base64',
    );

    const paidRes = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'x-mpp-credential': encodedCredential,
      },
    });

    if (!paidRes.ok) {
      const body = (await paidRes.json().catch(() => ({
        error: paidRes.statusText,
      }))) as { error?: string };
      return {
        success: false,
        paymentIntentId: pi.id,
        data: null,
        error: body.error ?? `Report fetch failed: HTTP ${paidRes.status}`,
      };
    }

    const body = (await paidRes.json()) as { data: unknown };
    log(`  MPP payment verified: ${pi.id}`);
    return { success: true, paymentIntentId: pi.id, data: body.data, error: null };
  }
}
