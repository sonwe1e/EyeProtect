import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { CommandState } from '../../../shared/types';

/**
 * Command-backed button (USERPLAN §十六 UI Contract).
 *
 * Renders the five states every interactive element must honour:
 *   - default   → idle, waiting for input
 *   - hover/focus → standard CSS (handled by .command-button)
 *   - pending   → spinner, disabled, aria-busy
 *   - success   → brief confirmation tick
 *   - disabled  → with an optional error reason shown adjacent
 *
 * It is intentionally a thin visual primitive: parent components own the
 * command logic (via `useCommand`) and pass the resulting `state` plus an
 * optional `errorReason`. This keeps feedback consistent across the whole app
 * without duplicating state machinery in every surface.
 */
export interface CommandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  state?: CommandState;
  /** Message shown in the tooltip / aria-description when state === 'error'. */
  errorReason?: string;
  /** Content shown transiently on success (defaults to a checkmark). */
  successContent?: ReactNode;
  /** How long (ms) to hold the success state before reverting to idle. */
  successHoldMs?: number;
  children: ReactNode;
}

export function CommandButton({
  state = 'idle',
  errorReason,
  successContent,
  successHoldMs = 1200,
  disabled,
  children,
  className = '',
  ...rest
}: CommandButtonProps): JSX.Element {
  const [showSuccess, setShowSuccess] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state === 'success') {
      setShowSuccess(true);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => setShowSuccess(false), successHoldMs);
    } else {
      setShowSuccess(false);
    }
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [state, successHoldMs]);

  const isPending = state === 'pending';
  const isDisabled = disabled || isPending;
  const classNames = [
    'command-button',
    `is-${state}`,
    showSuccess ? 'is-success-flash' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classNames}
      disabled={isDisabled}
      aria-busy={isPending}
      // Surface the failure reason to assistive tech: a `title` tooltip is
      // sighted/hover only, so we also expose the message as the accessible
      // description. No-op when there is no error.
      aria-description={state === 'error' && errorReason ? errorReason : undefined}
      title={state === 'error' && errorReason ? errorReason : rest.title}
      {...rest}
    >
      {isPending ? <span className="command-spinner" aria-hidden="true" /> : null}
      {showSuccess ? (
        <span className="command-success-mark" aria-hidden="true">
          {successContent ?? '✓'}
        </span>
      ) : null}
      <span className="command-button-label">{children}</span>
    </button>
  );
}
