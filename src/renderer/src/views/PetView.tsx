import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Clock3, Heart, ListChecks, Settings as SettingsIcon, X } from 'lucide-react';
import type { PetMood, PetSkin, StandaloneReminder } from '../../../shared/types';
import { PetCharacter } from '../features/pet/PetCharacter';
import { useCareStatus } from '../hooks/useCareStatus';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';
import { useTasks } from '../hooks/useTasks';

export default function PetView(): JSX.Element {
  const { settings } = useSettings();
  const reminderStatus = useReminderStatus();
  const care = useCareStatus();
  const tasks = useTasks();
  const [firingAlarms, setFiringAlarms] = useState<StandaloneReminder[]>([]);

  const handleSkinSelect = useCallback((skin: PetSkin) => {
    void window.eyeProtect.saveSettings({ petSkin: skin });
  }, []);
  const handleOpenAlarms = useCallback(() => {
    void window.eyeProtect.openWorkbench('reminders');
  }, []);
  const handleOpenTodos = useCallback(() => {
    void window.eyeProtect.openPanel('todos');
  }, []);
  const handlePetDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    const active = reminderStatus.activeReminder;
    if (active?.mode === 'gentle') {
      void window.eyeProtect.reminderAction('complete', active.id);
      return;
    }
    void window.eyeProtect.openSettings();
  }, [reminderStatus.activeReminder]);
  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    void window.eyeProtect.openWorkbench('reminders');
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
  const displaySkin: PetSkin =
    mood === 'sleeping'
      ? 'sleep'
      : mood === 'tired' || mood === 'anticipating'
        ? 'eye'
        : mood === 'happy'
          ? 'fu'
          : settings.petSkin;

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
        <button className="pet-gear" title="打开设置" onClick={() => void window.eyeProtect.openSettings()}>
          <SettingsIcon size={18} />
        </button>
      </div>

      <div className="character-stage">
        <PetCharacter
          skin={displaySkin}
          selectedSkin={settings.petSkin}
          mood={mood}
          accessory={care.accessory}
          onSelect={handleSkinSelect}
          onDoubleClick={handlePetDoubleClick}
          doubleClickHint={
            reminderStatus.activeReminder?.mode === 'gentle'
              ? '双击完成当前休息'
              : '双击打开设置'
          }
        />
      </div>

      <button
        type="button"
        className="pet-care-badge"
        title={`${care.message} · 点击查看本周趋势`}
        onClick={() => void window.eyeProtect.openSettings()}
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
