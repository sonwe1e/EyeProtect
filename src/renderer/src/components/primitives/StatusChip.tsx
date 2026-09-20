import type { ReactNode } from 'react';

export function StatusChip({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'brand' | 'warning' | 'danger';
  children: ReactNode;
}): JSX.Element {
  return <span className={`ui-status-chip ui-status-chip--${tone}`}>{children}</span>;
}
