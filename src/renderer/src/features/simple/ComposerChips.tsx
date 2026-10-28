import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, Droplet, Eye, Folder, Footprints } from 'lucide-react';
import type { Project } from '../../../../shared/types';

/**
 * Graphical second row under the composer input (quirk-ui A1): quick dates,
 * the target-list switcher and the health templates. Typing + Enter stays the
 * fastest path and is untouched; every chip is `type="button"` so it can never
 * hijack the form submit (ux interaction-spec §1.1 red line).
 *
 * Draft ownership: `due` lives in WorkbenchView so the submit can merge it into
 * the existing createTask call — this component is otherwise stateless about
 * the draft and only keeps popover open/close state locally. The list chip is
 * a graphical presentation of WorkbenchView's `list` state (lead decision):
 * switching it also switches the filter, one source of truth.
 */

export type ComposerDue = 'today' | 'tomorrow' | { custom: string };

/** One-click healthy tasks; click creates via the existing createTask path. */
export const HEALTH_TEMPLATE_TITLES: readonly string[] = ['喝杯水', '远眺 20 秒', '起身走两分钟'];

const HEALTH_TEMPLATE_ICONS: Record<string, typeof Droplet> = {
  '喝杯水': Droplet,
  '远眺 20 秒': Eye,
  '起身走两分钟': Footprints
};

export function ComposerChips({ due, onDueChange, targetListId, lists, onTargetListChange, onTemplateCreate, disabled }: {
  due: ComposerDue | null;
  onDueChange: (next: ComposerDue | null) => void;
  /** WorkbenchView's `list` state: 'all' | 'default' | projectId. */
  targetListId: string;
  lists: Project[];
  onTargetListChange: (id: string) => void;
  onTemplateCreate: (title: string) => void;
  disabled: boolean;
}): JSX.Element {
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const listAnchorRef = useRef<HTMLSpanElement | null>(null);
  const customAnchorRef = useRef<HTMLSpanElement | null>(null);
  const listChipRef = useRef<HTMLButtonElement | null>(null);
  const customChipRef = useRef<HTMLButtonElement | null>(null);

  // Popovers close on outside click and on Escape; they must stay inside the
  // workbench subtree (no portal) so the reduced-motion wildcard keeps covering
  // them. Escape refocuses the chip that owns the popover (ux §1.5).
  useEffect(() => {
    if (!listMenuOpen && !pickerOpen) return;
    const onDismiss = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (listMenuOpen && listAnchorRef.current && !listAnchorRef.current.contains(target)) setListMenuOpen(false);
      if (pickerOpen && customAnchorRef.current && !customAnchorRef.current.contains(target)) setPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (listMenuOpen) {
        event.preventDefault();
        setListMenuOpen(false);
        listChipRef.current?.focus();
      }
      if (pickerOpen) {
        event.preventDefault();
        setPickerOpen(false);
        customChipRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [listMenuOpen, pickerOpen]);

  const closePicker = (): void => {
    setPickerOpen(false);
    customChipRef.current?.focus();
  };

  const toggleQuickDue = (value: 'today' | 'tomorrow'): void => {
    setPickerOpen(false);
    onDueChange(due === value ? null : value);
  };

  // typeof null === 'object', so the null check must come first.
  const customDue = due !== null && typeof due === 'object' ? due : null;
  const customValue = customDue?.custom ?? '';
  const customSelected = (customDue?.custom.length ?? 0) > 0;
  const currentTarget = targetListId === 'all' || targetListId === 'default' ? 'default' : targetListId;
  const targetLabel = currentTarget === 'default' ? '默认清单' : lists.find((project) => project.id === currentTarget)?.name ?? '默认清单';
  const listOptions = [{ id: 'default', name: '默认清单' }, ...lists.map((project) => ({ id: project.id, name: project.name }))];

  return <div className="simple-composer-chips" role="group" aria-label="快速添加">
    <span className="simple-chip-anchor">
      <button type="button" className="simple-chip" aria-pressed={due === 'today'} disabled={disabled} onClick={() => toggleQuickDue('today')}>今天</button>
    </span>
    <span className="simple-chip-anchor">
      <button type="button" className="simple-chip" aria-pressed={due === 'tomorrow'} disabled={disabled} onClick={() => toggleQuickDue('tomorrow')}>明天</button>
    </span>
    <span className="simple-chip-anchor" ref={customAnchorRef}>
      <button type="button" ref={customChipRef} className="simple-chip" aria-pressed={customSelected} aria-expanded={pickerOpen} disabled={disabled}
        onClick={() => setPickerOpen(!pickerOpen)}>
        <CalendarDays size={14} aria-hidden="true" />
        自定义
      </button>
      {pickerOpen ? <div className="simple-composer-menu simple-composer-menu--date">
        <input
          type="date"
          aria-label="自定义截止日期"
          autoFocus
          value={customValue}
          onChange={(e) => { if (e.currentTarget.value) onDueChange({ custom: e.currentTarget.value }); }}
          onKeyDown={(e) => {
            // Enter must never bubble to the composer form: this popover is a
            // date confirmation, not a submit (ux §1.2 rule 3).
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closePicker();
            }
          }}
        />
      </div> : null}
    </span>
    <span className="simple-chip-anchor" ref={listAnchorRef}>
      <button type="button" ref={listChipRef} className="simple-chip" aria-expanded={listMenuOpen} disabled={disabled}
        onClick={() => setListMenuOpen(!listMenuOpen)}>
        <Folder size={14} aria-hidden="true" />
        <span className="simple-chip-label">{targetLabel}</span>
        <ChevronDown size={14} aria-hidden="true" className="simple-chip-chevron" />
      </button>
      {listMenuOpen ? <div className="simple-composer-menu" role="listbox" aria-label="选择清单">
        {listOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={option.id === currentTarget}
            onClick={() => { onTargetListChange(option.id); setListMenuOpen(false); listChipRef.current?.focus(); }}
          >
            {option.name}
          </button>
        ))}
      </div> : null}
    </span>
    {HEALTH_TEMPLATE_TITLES.map((templateTitle) => {
      const Icon = HEALTH_TEMPLATE_ICONS[templateTitle] ?? Droplet;
      return <button key={templateTitle} type="button" className="simple-chip simple-chip--health" disabled={disabled}
        onClick={() => onTemplateCreate(templateTitle)}>
        <Icon size={14} aria-hidden="true" />
        {templateTitle}
      </button>;
    })}
  </div>;
}
