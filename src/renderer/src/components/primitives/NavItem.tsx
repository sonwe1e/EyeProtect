import type { LucideIcon } from 'lucide-react';

export function NavItem({
  icon: Icon,
  label,
  count,
  selected = false,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  selected?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`app-nav-item ${selected ? 'is-active' : ''}`.trim()}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      {count ? <span className="app-nav-count">{count}</span> : null}
    </button>
  );
}
