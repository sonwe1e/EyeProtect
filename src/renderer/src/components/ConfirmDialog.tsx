import type { ButtonHTMLAttributes } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import type { ConfirmRequest } from '../hooks/useConfirm';

/** Dialog-driven replacement for `window.confirm`. */
export function ConfirmDialog({
  pending,
  onResolve,
}: {
  pending: ConfirmRequest | null;
  onResolve: (value: boolean) => void;
}): JSX.Element {
  const danger = pending?.danger === true;
  return (
    <Dialog
      open={pending !== null}
      title={pending?.title ?? '请确认'}
      description={pending?.detail || undefined}
      onClose={() => onResolve(false)}
      footer={
        <>
          <Button autoFocus={danger} onClick={() => onResolve(false)}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} autoFocus={!danger} onClick={() => onResolve(true)}>
            {pending?.confirmText ?? '确认'}
          </Button>
        </>
      }
    >
      <p>{pending?.message ?? ''}</p>
    </Dialog>
  );
}

export type ConfirmButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
