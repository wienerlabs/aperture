export interface PollOptions {
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly signal?: AbortSignal;
}

/**
 * Calls `attempt` repeatedly until it returns a non-null value or the
 * timeout elapses. Returns null on timeout. Honors an AbortSignal so callers
 * can cancel mid-poll (e.g. when the agent is being shut down).
 */
export async function pollUntil<T>(
  attempt: () => Promise<T | null>,
  opts: PollOptions,
): Promise<T | null> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return null;
    const value = await attempt();
    if (value !== null) return value;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(opts.intervalMs, remaining), opts.signal);
  }
  return null;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
