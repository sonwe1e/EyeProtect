import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { focusFirst, keepFocusInside } from './focusTrap';

export function SideSheet({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element | null {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => focusFirst(panelRef.current));
    return () => {
      cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="ui-sheet-layer">
      <button className="ui-sheet-scrim" type="button" aria-label="关闭任务详情" onClick={onClose} />
      <aside
        ref={panelRef}
        className="ui-side-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCloseRef.current();
          } else {
            keepFocusInside(event.nativeEvent, panelRef.current);
          }
          event.stopPropagation();
        }}
      >
        <header className="ui-side-sheet__header">
          <span>{title}</span>
          <IconButton aria-label="关闭任务详情" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="ui-side-sheet__body">{children}</div>
      </aside>
    </div>
  );
}
