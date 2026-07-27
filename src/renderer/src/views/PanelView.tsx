import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, ListChecks, X } from 'lucide-react';
import type { PanelTab, TodoPriority } from '../../../shared/types';
import { AlarmSection } from '../features/alarms/AlarmSection';
import { TodoSection } from '../features/todos/TodoSection';
import { useAlarms } from '../hooks/useAlarms';
import { useTodos } from '../hooks/useTodos';

const NUDGE_RESET_MS = 1800;

export default function PanelView(): JSX.Element {
  const [tab, setTab] = useState<PanelTab>('todos');
  const alarms = useAlarms();
  const todos = useTodos();
  const [nudge, setNudge] = useState(false);
  const dirtyRef = useRef(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getPanelTab().then((initialTab) => {
      if (mounted) {
        setTab(initialTab);
      }
    });
    const offTab = window.eyeProtect.onPanelTab(setTab);
    return () => {
      mounted = false;
      offTab();
    };
  }, []);

  useEffect(() => {
    const offBlur = window.eyeProtect.onPanelBlur(() => {
      if (dirtyRef.current) {
        setNudge(true);
        if (nudgeTimerRef.current) {
          clearTimeout(nudgeTimerRef.current);
        }
        nudgeTimerRef.current = setTimeout(() => setNudge(false), NUDGE_RESET_MS);
        return;
      }
      void window.eyeProtect.closePanel();
    });
    return () => {
      offBlur();
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !dirtyRef.current) {
        void window.eyeProtect.closePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const handleAddTodo = useCallback((text: string) => {
    void window.eyeProtect.addTodo(text);
  }, []);
  const handleToggleTodo = useCallback((id: string) => {
    void window.eyeProtect.toggleTodo(id);
  }, []);
  const handleUpdateTodo = useCallback((id: string, text: string) => {
    void window.eyeProtect.updateTodo(id, text);
  }, []);
  const handleRemoveTodo = useCallback((id: string) => {
    void window.eyeProtect.removeTodo(id);
  }, []);
  const handleSetTodoPriority = useCallback((id: string, priority: TodoPriority) => {
    void window.eyeProtect.setTodoPriority(id, priority);
  }, []);
  const handleCancelAlarm = useCallback((id: string) => {
    void window.eyeProtect.cancelAlarm(id);
  }, []);

  const pendingCount = useMemo(() => todos.filter((todo) => !todo.completed).length, [todos]);

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <div className="panel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'todos'}
            className={tab === 'todos' ? 'is-active' : ''}
            title={`共 ${todos.length} 件，已完成 ${todos.length - pendingCount} 件`}
            onClick={() => setTab('todos')}
          >
            <ListChecks size={15} />
            待办
            {pendingCount > 0 ? <span className="panel-tab-count">{pendingCount}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'alarms'}
            className={tab === 'alarms' ? 'is-active' : ''}
            onClick={() => setTab('alarms')}
          >
            <Clock3 size={15} />
            闹钟
            {alarms.length > 0 ? <span className="panel-tab-count">{alarms.length}</span> : null}
          </button>
        </div>
        <button
          type="button"
          className="panel-close"
          title="关闭"
          onClick={() => void window.eyeProtect.closePanel()}
        >
          <X size={16} />
        </button>
      </header>

      {nudge ? <span className="panel-nudge">有未保存内容，按 Esc 或点 × 关闭</span> : null}

      <div className="panel-body">
        {tab === 'todos' ? (
          <TodoSection
            todos={todos}
            onAdd={handleAddTodo}
            onToggle={handleToggleTodo}
            onUpdate={handleUpdateTodo}
            onRemove={handleRemoveTodo}
            onPriorityChange={handleSetTodoPriority}
            onDirtyChange={handleDirtyChange}
          />
        ) : (
          <AlarmSection alarms={alarms} onCancel={handleCancelAlarm} onDirtyChange={handleDirtyChange} />
        )}
      </div>
    </main>
  );
}
