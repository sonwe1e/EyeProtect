import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { Clock3, Gift, Heart, ListChecks, Settings as SettingsIcon, X } from 'lucide-react';
import type { PetMood, StandaloneReminder } from '../../../shared/types';
import { PetCharacter } from '../features/pet/PetCharacter';
import { useCareStatus } from '../hooks/useCareStatus';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { usePendingTaskCount } from '../hooks/usePendingTaskCount';
import { useSettings } from '../hooks/useSettings';
import { activeCharacterFrom, useCharacterCollection } from '../hooks/useCharacterCollection';
import { commands } from '../lib/commands';

export default function PetView(): JSX.Element {
  const reminderStatus = useReminderStatus();
  const care = useCareStatus();
  const pendingCount = usePendingTaskCount();
  const collection = useCharacterCollection();
  const { settings } = useSettings();
  const [firingAlarms, setFiringAlarms] = useState<StandaloneReminder[]>([]);
  const dragRef = useRef<{
    pointerId: number;
    screenX: number;
    screenY: number;
    windowX: number;
    windowY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const handleOpenAlarms = useCallback(() => {
    void window.eyeProtect.openWorkbench('reminders');
  }, []);
  const handleOpenTodos = useCallback(() => {
    void window.eyeProtect.openWorkbench('today');
  }, []);
  const handlePetDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    const active = reminderStatus.activeReminder;
    if (active?.mode === 'gentle') {
      void commands.reminderActions.act('complete', active.id);
      return;
    }
    void window.eyeProtect.openWorkbench('today');
  }, [reminderStatus.activeReminder]);
  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    void window.eyeProtect.openWorkbench('collection');
  }, []);
  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Capture before the pointer moves. A small transparent always-on-top
    // window can otherwise lose a fast pointer before the drag threshold is
    // crossed, especially at non-100% Windows display scaling.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      windowX: window.screenX,
      windowY: window.screenY,
      moved: false
    };
  }, []);
  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.screenX - drag.screenX;
    const dy = event.screenY - drag.screenY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setDragging(true);
    void window.eyeProtect.movePetWindow({ x: drag.windowX + dx, y: drag.windowY + dy });
  }, []);
  const handlePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) suppressClickUntilRef.current = Date.now() + 400;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    return window.eyeProtect.onStandaloneReminderFired((alarm) => {
      setFiringAlarms((current) => {
        if (current.some((entry) => entry.id === alarm.id)) {
          return current;
        }
        // Keep only the most recent fired alarms: the badge is dismissed as a
        // whole, and an unbounded array would grow by one per firing for the
        // whole window lifetime.
        return [...current, alarm].slice(-5);
      });
    });
  }, []);

  const isFiring = firingAlarms.length > 0;
  const mood: PetMood = reminderStatus.preAlert ? 'anticipating' : care.mood;
  const character = activeCharacterFrom(collection);
  const accessory = character.accessory === 'none' ? care.accessory : character.accessory;
  const hasGift = collection.candidate?.decision === 'pending';
  const compactPet = settings.petScale < 0.7;

  return (
    <main className={`pet-shell ${compactPet ? 'pet-compact' : ''} ${isFiring ? 'alarms-active' : ''}`.trim()} onContextMenu={handleContextMenu}>
      {!compactPet ? <div className="pet-toolbar">
        <button
          className={`pet-todo-tab ${pendingCount > 0 ? 'has-todos' : ''}`.trim()}
          title="待办"
          onClick={handleOpenTodos}
        >
          <ListChecks size={16} />
          <span className="pet-todo-tab-label">待办</span>
          {pendingCount > 0 ? <span className="todo-count">{pendingCount}</span> : null}
        </button>
        <button className="pet-alarm" title="闹钟" onClick={handleOpenAlarms}>
          <Clock3 size={18} />
        </button>
        <button className="pet-gear" title="打开设置" onClick={() => void window.eyeProtect.openWorkbench('settings')}>
          <SettingsIcon size={18} />
        </button>
      </div> : null}

      <div className="character-stage">
        <div
          className={`pet-drag-surface ${dragging ? 'is-dragging' : ''}`.trim()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onClickCapture={(event) => {
            if (Date.now() <= suppressClickUntilRef.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <PetCharacter
            character={character}
            mood={mood}
            accessory={accessory}
            onDoubleClick={handlePetDoubleClick}
            doubleClickHint={
              reminderStatus.activeReminder?.mode === 'gentle'
                ? '双击完成当前休息'
                : '双击打开工作台'
            }
          />
        </div>
        <div className="pet-drag-handle" aria-hidden="true" title="按住拖动桌宠" />
      </div>

      {hasGift ? (
        <button type="button" className="pet-gift-badge" title="今天有一位新朋友" onClick={() => void window.eyeProtect.openWorkbench('collection')}>
          <Gift size={15} />
        </button>
      ) : null}

      <button
        type="button"
        className="pet-care-badge"
        title={`${care.message} · 点击查看本周趋势`}
        onClick={() => void window.eyeProtect.openWorkbench('settings')}
      >
        <Heart size={12} />
        <span>{care.score}</span>
      </button>

      {isFiring ? (
        <button
          type="button"
          className="alarm-dismiss"
          title="关闭闹钟提醒"
          onClick={() => setFiringAlarms([])}
        >
          <X size={18} />
        </button>
      ) : null}
    </main>
  );
}
