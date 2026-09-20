import type { ReactNode } from 'react';

export function Toast({
  tone = 'neutral',
  role = 'status',
  children,
  actions
}: {
  tone?: 'neutral' | 'danger';
  role?: 'status' | 'alert';
  children: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className={`ui-toast ui-toast--${tone}`} role={role}>
      <div className="ui-toast__content">{children}</div>
      {actions ? <div className="ui-toast__actions">{actions}</div> : null}
    </div>
  );
}
