import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
}

/**
 * Themed replacement for window.confirm. Resolves true on confirm, false on
 * cancel / Escape / backdrop. Keyboard focus is trapped by Dialog.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback(
    (next: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        // A second confirm while one is open must not orphan the first promise.
        const previous = resolverRef.current;
        resolverRef.current = null;
        previous?.(false);
        resolverRef.current = resolve;
        setRequest(next);
      }),
    []
  );

  useEffect(() => () => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(false);
  }, []);

  const dialog = request ? (
    <Dialog
      open
      title={request.title}
      description={request.description}
      onClose={() => settle(false)}
      footer={
        <>
          <button type="button" className="ui-button ui-button--secondary" onClick={() => settle(false)}>
            取消
          </button>
          <button
            type="button"
            className={`ui-button ${request.danger ? 'ui-button--danger' : 'ui-button--primary'}`}
            onClick={() => settle(true)}
          >
            {request.confirmLabel ?? '确认'}
          </button>
        </>
      }
    >
      <span className="ui-confirm-spacer" aria-hidden="true" />
    </Dialog>
  ) : null;

  return { confirm, dialog };
}
