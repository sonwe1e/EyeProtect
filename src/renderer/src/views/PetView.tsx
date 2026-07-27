import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Clock3, ListChecks, Settings as SettingsIcon, X } from 'lucide-react';
import type { Alarm, PetSkin } from '../../../shared/types';
import { PetCharacter } from '../features/pet/PetCharacter';
import { useSettings } from '../hooks/useSettings';
import { useTodos } from '../hooks/useTodos';

export default function PetView(): JSX.Element {
  const { settings } = useSettings();
  const todos = useTodos();
  const [firingAlarms, setFiringAlarms] = useState<Alarm[]>([]);

  const handleSkinSelect = useCallback((skin: PetSkin) => {
    void window.eyeProtect.saveSettings({ petSkin: skin });
  }, []);
  const handleOpenAlarms = useCallback(() => {
    void window.eyeProtect.openPanel('alarms');
  }, []);
  const handleOpenTodos = useCallback(() => {
    void window.eyeProtect.openPanel('todos');
  }, []);
  const handlePetDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    void window.eyeProtect.openSettings();
  }, []);
  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    void window.eyeProtect.openPanel('alarms');
  }, []);

  useEffect(() => {
    return window.eyeProtect.onAlarmFired((alarm) => {
      setFiringAlarms((current) =>
        current.some((entry) => entry.id === alarm.id) ? current : [...current, alarm]
      );
    });
  }, []);

  const pendingCount = useMemo(() => todos.filter((todo) => !todo.completed).length, [todos]);
  const isFiring = firingAlarms.length > 0;

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
          skin={settings.petSkin}
          onSelect={handleSkinSelect}
          onDoubleClick={handlePetDoubleClick}
        />
      </div>

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
