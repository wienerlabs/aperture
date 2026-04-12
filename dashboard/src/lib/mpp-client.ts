/**
 * MPP (Machine Payments Protocol) client for the dashboard.
 * Handles the full MPP flow: request -> 402 -> Stripe payment -> retry with credential.
 */
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

export interface MPPResult<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly payment: {
    readonly protocol: 'mpp';
    readonly paymentIntentId: string;
    readonly clientSecret: string;
    readonly amount: string;
    readonly currency: string;
    readonly zkProofHash: string | null;
    readonly solanaTxSignature: string | null;
  } | null;
  readonly error: string | null;
}

/**
 * Confirm a Stripe PaymentIntent using the Stripe.js library.
 * In test mode, uses pm_card_visa for automatic confirmation.
 */
async function confirmStripePayment(
  clientSecret: string,
  publishableKey: string,
): Promise<string> {
  const { loadStripe } = await import('@stripe/stripe-js');
  const stripe = await loadStripe(publishableKey);
  if (!stripe) {
    throw new Error('Failed to load Stripe.js');
  }

  const { error, paymentIntent } = await stripe.confirmCardPayment(
    clientSecret,
    { payment_method: 'pm_card_visa' },
  );

  if (error) {
    throw new Error(error.message ?? 'Stripe payment confirmation failed');
  }

  if (!paymentIntent || paymentIntent.status !== 'succeeded') {
    throw new Error(
      `Payment not completed. Status: ${paymentIntent?.status ?? 'unknown'}`,
    );
  }

  return paymentIntent.id;
}

/**
 * Fetch a resource with MPP payment flow.
 * 1. Makes initial request
 * 2. If 402 returned, parses challenge with Stripe PaymentIntent
 * 3. Confirms payment via Stripe.js
 * 4. Optionally generates ZK proof via prover service
 * 5. Retries request with x-mpp-credential header
 */
export async function fetchWithMPP<T>(
  endpoint: string,
  stripePublishableKey: string,
): Promise<MPPResult<T>> {
  // Step 1: Initial request (expect 402)
  const initialRes = await fetch(endpoint, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (initialRes.ok) {
    const body = await initialRes.json();
    return { success: true, data: body.data, payment: null, error: null };
  }

  if (initialRes.status !== 402) {
    const body = await initialRes
      .json()
      .catch(() => ({ error: initialRes.statusText }));
    return {
      success: false,
      data: null,
      payment: null,
      error: body.error ?? `HTTP ${initialRes.status}`,
    };
  }

  // Step 2: Parse 402 challenge
  const challengeBody = await initialRes.json();
  const challenge: MPPChallenge | undefined = challengeBody.mppChallenge;

  if (!challenge) {
    return {
      success: false,
      data: null,
      payment: null,
      error: 'Invalid 402 response: no mppChallenge',
    };
  }

  // Step 3: Confirm Stripe payment
  const paymentIntentId = await confirmStripePayment(
    challenge.stripe.clientSecret,
    stripePublishableKey,
  );

  // Step 4: Build credential and retry
  const credential: MPPCredential = {
    challengeId: challenge.id,
    paymentIntentId,
  };
  const encodedCredential = btoa(JSON.stringify(credential));

  const paidRes = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      'x-mpp-credential': encodedCredential,
    },
  });

  const paymentInfo = {
    protocol: 'mpp' as const,
    paymentIntentId,
    clientSecret: challenge.stripe.clientSecret,
    amount: challenge.request.amount,
    currency: challenge.request.currency,
    zkProofHash: null as string | null,
    solanaTxSignature: null as string | null,
  };

  if (!paidRes.ok) {
    const body = await paidRes
      .json()
      .catch(() => ({ error: paidRes.statusText }));
    return {
      success: false,
      data: null,
      payment: paymentInfo,
      error:
        body.error ??
        `Payment accepted but report failed: HTTP ${paidRes.status}`,
    };
  }

  const body = await paidRes.json();
  return {
    success: true,
    data: body.data,
    payment: paymentInfo,
    error: null,
  };
}
