'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  TxModal,
  type TxModalProps,
  type TxParticipant,
  type TxStatus,
} from '@/components/shared/TxModal';

type TxModalState = Omit<TxModalProps, 'open' | 'onClose'>;

interface TxController {
  /** Open the modal with initial data (typically status="pending"). */
  show(state: TxModalState): void;
  /** Patch the visible modal (e.g. flip to success and add txSignature). */
  update(patch: Partial<TxModalState>): void;
  /** Close immediately. */
  hide(): void;
}

const TxModalContext = createContext<TxController | null>(null);

export function TxModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TxModalState | null>(null);

  const show = useCallback((next: TxModalState) => {
    setState(next);
    setOpen(true);
  }, []);

  const update = useCallback((patch: Partial<TxModalState>) => {
    setState((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
  }, []);

  const controller = useMemo<TxController>(
    () => ({ show, update, hide }),
    [show, update, hide],
  );

  return (
    <TxModalContext.Provider value={controller}>
      {children}
      {state && (
        <TxModal
          open={open}
          onClose={hide}
          status={state.status}
          title={state.title}
          subtitle={state.subtitle}
          from={state.from}
          to={state.to}
          txSignature={state.txSignature}
          footnote={state.footnote}
          errorMessage={state.errorMessage}
        />
      )}
    </TxModalContext.Provider>
  );
}

export function useTxModal(): TxController {
  const ctx = useContext(TxModalContext);
  if (!ctx) {
    throw new Error('useTxModal must be used inside <TxModalProvider>');
  }
  return ctx;
}

// Re-export so callers don't need a separate import path.
export type { TxModalState, TxParticipant, TxStatus };
