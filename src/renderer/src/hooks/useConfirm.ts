import { useCallback, useRef, useState } from 'react';

export interface ConfirmRequest {
  message: string;
  detail?: string;
  /** Dialog title. Defaults to "请确认". */
  title?: string;
  /** Confirm button label. Defaults to "确认". */
  confirmText?: string;
  /** Danger styling on the confirm button + initial focus on cancel. */
  danger?: boolean;
}

/**
 * Async confirm hook (quality step 4).
 * Replaces blocking `window.confirm` with a Dialog-driven promise so focus
 * trapping, styling and keyboard handling stay consistent.
 */
export function useConfirm(): {
  pending: ConfirmRequest | null;
  confirm: (message: string, options?: string | Omit<ConfirmRequest, 'message'>) => Promise<boolean>;
  resolveConfirm: (value: boolean) => void;
} {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((message: string, options?: string | Omit<ConfirmRequest, 'message'>): Promise<boolean> => {
    const request: ConfirmRequest = typeof options === 'string'
      ? { message, detail: options }
      : { message, ...options };
    setPending(request);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const resolveConfirm = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setPending(null);
  }, []);

  return { pending, confirm, resolveConfirm };
}
