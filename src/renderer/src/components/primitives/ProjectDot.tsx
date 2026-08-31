import type { CSSProperties } from 'react';

export function ProjectDot({ color, className = '' }: { color: string | null; className?: string }): JSX.Element {
  return (
    <span
      className={`ui-project-dot ${className}`.trim()}
      style={{ '--project-dot-color': color ?? 'var(--fg-tertiary)' } as CSSProperties}
      aria-hidden="true"
    />
  );
}
