'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CreditCard,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Trash2,
  X,
} from 'lucide-react';
import { config } from '@/lib/config';
import {
  loadStripe,
  type Stripe,
  type StripeElements,
  type StripeCardElement,
} from '@stripe/stripe-js';
import { fetchMppPublicConfig } from '@/lib/mpp-client';

interface SavedCredentials {
  readonly operator_id: string;
  readonly stripe_customer_id: string;
  readonly stripe_payment_method_id: string;
  readonly card_brand: string | null;
  readonly card_last4: string | null;
}

interface AgentStripeCardProps {
  readonly operatorId: string | null;
}

/**
 * Settings panel that lets the operator save a Stripe card the agent will
 * charge with off_session=true during MPP cycles. Uses Stripe SetupIntent —
 * no charge is created, only the card is tokenized + attached to the
 * operator's Customer.
 *
 * The agent-service polls compliance-api for these credentials each cycle;
 * removing the card here makes the next cycle skip MPP gracefully.
 */
export function AgentStripeCard({ operatorId }: AgentStripeCardProps): React.ReactElement {
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [savedCredentials, setSavedCredentials] = useState<SavedCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCardForm, setShowCardForm] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const cardElementRef = useRef<StripeCardElement | null>(null);
  const cardMountRef = useRef<HTMLDivElement | null>(null);
  const clientSecretRef = useRef<string | null>(null);
  const customerIdRef = useRef<string | null>(null);
  const [cardReady, setCardReady] = useState(false);

  // ---- Load publishable key + saved credentials on mount ------------------
  useEffect(() => {
    if (!operatorId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchMppPublicConfig().catch(() => null),
      fetch(`${config.complianceApiUrl}/api/v1/agent/stripe/credentials/${operatorId}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([cfg, credResp]) => {
        if (cancelled) return;
        setPublishableKey(cfg?.stripe.publishableKey ?? null);
        if (credResp?.success && credResp?.data) {
          setSavedCredentials(credResp.data as SavedCredentials);
        } else {
          setSavedCredentials(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operatorId]);

  async function startSetupFlow(): Promise<void> {
    if (!operatorId) return;
    if (!publishableKey) {
      setError(
        'Stripe publishable key not configured on the compliance-api. Set STRIPE_PUBLISHABLE_KEY and restart.',
      );
      return;
    }

    setError(null);
    setSavingCard(true);
    setStatus('Requesting SetupIntent…');
    try {
      const setupRes = await fetch(
        `${config.complianceApiUrl}/api/v1/agent/stripe/setup-intent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operator_id: operatorId }),
        },
      );
      if (!setupRes.ok) {
        const body = await setupRes.json().catch(() => ({}));
        throw new Error(body.error ?? `SetupIntent creation failed (HTTP ${setupRes.status})`);
      }
      const setupBody = await setupRes.json();
      clientSecretRef.current = setupBody.data.client_secret;
      customerIdRef.current = setupBody.data.customer_id;

      if (!stripeRef.current) {
        stripeRef.current = await loadStripe(publishableKey);
      }
      if (!stripeRef.current) throw new Error('Stripe.js failed to load');

      const elements = stripeRef.current.elements();
      elementsRef.current = elements;
      setShowCardForm(true);
      setStatus('Enter card details and confirm.');

      // Defer mount so React renders the form first
      setTimeout(() => {
        if (!cardMountRef.current || !elementsRef.current) return;
        const card = elementsRef.current.create('card', {
          style: {
            base: {
              color: '#fef3c7',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '14px',
              '::placeholder': { color: 'rgba(254, 243, 199, 0.4)' },
            },
            invalid: { color: '#f87171' },
          },
        });
        card.mount(cardMountRef.current);
        card.on('ready', () => setCardReady(true));
        cardElementRef.current = card;
      }, 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start SetupIntent flow');
      setStatus(null);
    } finally {
      setSavingCard(false);
    }
  }

  async function confirmAndSave(): Promise<void> {
    if (!operatorId) return;
    if (!stripeRef.current || !clientSecretRef.current || !customerIdRef.current || !cardElementRef.current) {
      setError('Stripe flow not initialized');
      return;
    }
    setError(null);
    setSavingCard(true);
    setStatus('Validating card with Stripe…');
    try {
      const result = await stripeRef.current.confirmCardSetup(
        clientSecretRef.current,
        {
          payment_method: { card: cardElementRef.current },
        },
      );
      if (result.error) {
        throw new Error(result.error.message ?? 'Stripe rejected the card');
      }
      const setupIntent = result.setupIntent;
      if (!setupIntent || setupIntent.status !== 'succeeded') {
        throw new Error(`SetupIntent status: ${setupIntent?.status ?? 'unknown'}`);
      }
      const paymentMethodId =
        typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;
      if (!paymentMethodId) {
        throw new Error('SetupIntent did not return a payment_method id');
      }

      setStatus('Saving credentials…');
      const persistRes = await fetch(
        `${config.complianceApiUrl}/api/v1/agent/stripe/credentials`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operator_id: operatorId,
            payment_method_id: paymentMethodId,
            customer_id: customerIdRef.current,
          }),
        },
      );
      if (!persistRes.ok) {
        const body = await persistRes.json().catch(() => ({}));
        throw new Error(body.error ?? `Persist failed (HTTP ${persistRes.status})`);
      }
      const persistBody = await persistRes.json();
      setSavedCredentials(persistBody.data as SavedCredentials);

      // Reset card form
      cardElementRef.current?.destroy();
      cardElementRef.current = null;
      elementsRef.current = null;
      clientSecretRef.current = null;
      customerIdRef.current = null;
      setCardReady(false);
      setShowCardForm(false);
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save card');
      setStatus(null);
    } finally {
      setSavingCard(false);
    }
  }

  function cancelCardForm(): void {
    cardElementRef.current?.destroy();
    cardElementRef.current = null;
    elementsRef.current = null;
    clientSecretRef.current = null;
    customerIdRef.current = null;
    setCardReady(false);
    setShowCardForm(false);
    setStatus(null);
    setError(null);
  }

  async function removeCard(): Promise<void> {
    if (!operatorId || !savedCredentials) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(
        `${config.complianceApiUrl}/api/v1/agent/stripe/credentials/${operatorId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Delete failed (HTTP ${res.status})`);
      }
      setSavedCredentials(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove card');
    } finally {
      setRemoving(false);
    }
  }

  if (!operatorId) {
    return (
      <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <CreditCard className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-amber-100">Agent Stripe Configuration</h3>
        </div>
        <p className="text-sm text-amber-100/40">Connect your wallet to configure the agent&apos;s Stripe card.</p>
      </div>
    );
  }

  return (
    <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <CreditCard className="w-5 h-5 text-amber-400" />
        <h3 className="text-lg font-semibold text-amber-100">Agent Stripe Configuration</h3>
      </div>

      <p className="text-sm text-amber-100/60 mb-4">
        Save a card the agent will charge during MPP cycles. Card is tokenized via
        Stripe SetupIntent (no charge created). Removing the card makes the agent
        skip MPP automatically — x402 cycles continue.
      </p>

      {loading && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-400/5 border border-amber-400/10 text-amber-100/60">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {!loading && !publishableKey && (
        <div className="p-3 rounded-lg bg-amber-400/5 border border-amber-400/20 text-amber-100/60 text-xs">
          Stripe publishable key not configured on the compliance-api.
        </div>
      )}

      {!loading && publishableKey && savedCredentials && !showCardForm && (
        <div className="space-y-3">
          <div className="p-4 rounded-lg bg-green-400/5 border border-green-400/10">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-green-400">
                Card saved — agent MPP cycle is enabled
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-amber-100/40">Card</span>
                <p className="text-amber-100 font-mono mt-0.5">
                  {(savedCredentials.card_brand ?? 'card').toUpperCase()} •••• {savedCredentials.card_last4 ?? '????'}
                </p>
              </div>
              <div>
                <span className="text-amber-100/40">Stripe Customer</span>
                <p className="text-amber-100 font-mono mt-0.5 text-xs break-all">
                  {savedCredentials.stripe_customer_id}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={startSetupFlow}
              disabled={savingCard || removing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-amber-100/5 text-amber-100 border border-amber-400/20
                hover:bg-amber-100/10 disabled:opacity-50 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              Replace Card
            </button>
            <button
              onClick={removeCard}
              disabled={savingCard || removing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-red-400/10 text-red-400 border border-red-400/20
                hover:bg-red-400/20 disabled:opacity-50 transition-colors"
            >
              {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Remove
            </button>
          </div>
        </div>
      )}

      {!loading && publishableKey && !savedCredentials && !showCardForm && (
        <button
          onClick={startSetupFlow}
          disabled={savingCard}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
            bg-amber-500 text-black hover:bg-amber-400
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {savingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
          Configure Agent Card
        </button>
      )}

      {showCardForm && (
        <div className="space-y-3 mt-2">
          <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/20">
            <p className="text-xs text-amber-100/50 mb-2">
              Test mode: <code className="text-amber-400">4242 4242 4242 4242</code>, any future expiry, any CVC, any ZIP.
              No charge is created — Stripe only verifies and tokenizes the card.
            </p>
            <div
              ref={cardMountRef}
              className="p-3 rounded bg-[rgba(0,0,0,0.5)] border border-amber-400/10 min-h-[42px]"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={confirmAndSave}
                disabled={savingCard || !cardReady}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                  bg-amber-500 text-black hover:bg-amber-400
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {savingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Save Card
              </button>
              <button
                onClick={cancelCardForm}
                disabled={savingCard}
                className="px-4 py-2 rounded-lg text-sm font-medium
                  bg-amber-100/5 text-amber-100/60 border border-amber-400/20
                  hover:bg-amber-100/10 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {status && !error && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-300 mt-3">
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          <p className="text-xs">{status}</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 mt-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <pre className="text-xs whitespace-pre-wrap break-words flex-1 font-mono">{error}</pre>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
