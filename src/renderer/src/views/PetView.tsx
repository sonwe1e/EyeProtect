import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Clock3, Gift, Heart, ListChecks, Settings as SettingsIcon, X } from 'lucide-react';
import type { PetMood, StandaloneReminder } from '../../../shared/types';
import { PetCharacter } from '../features/pet/PetCharacter';
import { useCareStatus } from '../hooks/useCareStatus';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useTasks } from '../hooks/useTasks';
import { activeCharacterFrom, useCharacterCollection } from '../hooks/useCharacterCollection';
import { commands } from '../lib/commands';

export default function PetView(): JSX.Element {
  const reminderStatus = useReminderStatus();
  const care = useCareStatus();
  const tasks = useTasks();
  const collection = useCharacterCollection();
  const [firingAlarms, setFiringAlarms] = useState<StandaloneReminder[]>([]);

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

  useEffect(() => {
    return window.eyeProtect.onStandaloneReminderFired((alarm) => {
      setFiringAlarms((current) =>
        current.some((entry) => entry.id === alarm.id) ? current : [...current, alarm]
      );
    });
  }, []);

  const pendingCount = useMemo(() => tasks.filter((task) => task.status !== 'done' && task.status !== 'archived').length, [tasks]);
  const isFiring = firingAlarms.length > 0;
  const mood: PetMood = reminderStatus.preAlert ? 'anticipating' : care.mood;
  const character = activeCharacterFrom(collection);
  const accessory = character.accessory === 'none' ? care.accessory : character.accessory;
  const hasGift = collection.candidate?.decision === 'pending';

  return (
    <main className={`pet-shell ${isFiring ? 'alarms-active' : ''}`.trim()} onContextMenu={handleContextMenu}>
      <div className="pet-toolbar">
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
      </div>

      <div className="character-stage">
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
