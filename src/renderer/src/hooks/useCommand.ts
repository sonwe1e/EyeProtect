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
  const inFlight = useRef<{ args: unknown[]; promise: Promise<CommandResult<T>> } | null>(null);
  const commandRef = useRef(command);
  commandRef.current = command;

  const run = useCallback(
    async (...args: Args): Promise<CommandResult<T>> => {
      const myTurn = ++generation.current;
      const pending = inFlight.current;
      // Double-submit protection: a repeat call with IDENTICAL arguments (a
      // double-click on 删除, a stale Enter+click pair) joins the pending
      // promise instead of firing a duplicate mutation. A call with DIFFERENT
      // arguments is a new intent (second arrow press, a different material
      // selection) and must never be silently dropped — run it concurrently
      // and let the generation guard make the latest outcome win.
      if (pending && JSON.stringify(pending.args) === JSON.stringify(args)) {
        return pending.promise;
      }
      setState('pending');
      setResult(null);
      const promise = commandRef.current(...args);
      inFlight.current = { args, promise };
      try {
        const outcome = await promise;
        // A newer call started while we were awaiting — drop this stale result.
        if (myTurn !== generation.current) {
          return outcome;
        }
        setResult(outcome);
        setState(outcome.ok ? 'success' : 'error');
        return outcome;
      } finally {
        // Only clear the guard when this promise is still the current flight;
        // a concurrent newer call owns the slot.
        if (inFlight.current?.promise === promise) {
          inFlight.current = null;
        }
      }
    },
    []
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
