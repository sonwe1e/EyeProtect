import { useCallback, useRef, useState } from 'react';
import type { CommandResult, CommandState } from '../../../shared/types';

/**
 * React binding for the command layer (USERPLAN §十五).
 *
 * Wraps an async command and exposes the lifecycle every interactive element
 * needs: `state` (idle → pending → success|error), the last `result`, a `run`
 * callback, and `reset`. The latest invocation always wins — a stale resolve
 * from a superseded call is discarded so rapid clicks can't flash a stale
 * success over a fresh error.
 *
 * Usage:
 *   const { run, state, result } = useCommand(() => commands.tasks.create(input));
 *   <button disabled={state === 'pending'} onClick={() => void run()}>...</button>
 */
export interface UseCommandApi<T, Args extends unknown[]> {
  state: CommandState;
  result: CommandResult<T> | null;
  /** True while the latest invocation is in flight. */
  isPending: boolean;
  /** The latest failure, if any — handy for inline error messages. */
  error: Extract<CommandResult<T>, { ok: false }> | null;
  run: (...args: Args) => Promise<CommandResult<T>>;
  reset: () => void;
}

export function useCommand<T, Args extends unknown[]>(
  command: (...args: Args) => Promise<CommandResult<T>>
): UseCommandApi<T, Args> {
  const [state, setState] = useState<CommandState>('idle');
  const [result, setResult] = useState<CommandResult<T> | null>(null);
  // Monotonic guard so a slow first click can't overwrite a newer outcome.
  const generation = useRef(0);
  // In-flight dedupe: while a mutation is pending, a second `run` joins it
  // instead of firing a duplicate IPC call. This closes the render-latency
  // window between a click and the button's disabled-when-pending state, and
  // covers the keyboard-Enter + click double-submit path. Resolved once the
  // current flight settles.
  const inFlight = useRef<Promise<CommandResult<T>> | null>(null);

  const run = useCallback(
    async (...args: Args): Promise<CommandResult<T>> => {
      // Join the in-flight request rather than starting a second mutation.
      if (inFlight.current) {
        return inFlight.current;
      }
      const myTurn = ++generation.current;
      setState('pending');
      setResult(null);
      inFlight.current = command(...args);
      try {
        const outcome = await inFlight.current;
        // A newer call started while we were awaiting — drop this stale result.
        if (myTurn !== generation.current) {
          return outcome;
        }
        setResult(outcome);
        setState(outcome.ok ? 'success' : 'error');
        return outcome;
      } finally {
        // Always clear the in-flight guard so a rejection can't permanently
        // lock the button in the pending/disabled state. Without this, a
        // command that rejects would leave inFlight set and every later run()
        // would join the dead promise forever.
        inFlight.current = null;
      }
    },
    [command]
  );

  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current = null;
    setState('idle');
    setResult(null);
  }, []);

  return {
    state,
    result,
    isPending: state === 'pending',
    error: result && !result.ok ? result : null,
    run,
    reset
  };
}
