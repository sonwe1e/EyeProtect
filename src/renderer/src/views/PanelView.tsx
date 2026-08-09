import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Eye, Footprints, Pause, Play, Plus, X } from 'lucide-react';
import { matchesTaskView, sortTasksForView, TASK_TITLE_MAX } from '../../../shared/types';
import { useClock } from '../hooks/useClock';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useTasks } from '../hooks/useTasks';
import { formatClock, minutesLeft } from '../lib/time';

export default function PanelView(): JSX.Element {
  const tasks = useTasks();
  const reminder = useReminderStatus();
  const now = useClock(30_000);
  const [draft, setDraft] = useState('');
  const [nudge, setNudge] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirty = draft.trim().length > 0;

  const today = useMemo(
    () => sortTasksForView(tasks.filter((task) => matchesTaskView(task, 'today', now)), now).slice(0, 3),
    [tasks, now]
  );

  useEffect(() => window.eyeProtect.onQuickAddTodo(() => inputRef.current?.focus()), []);
  useEffect(() => {
    void window.eyeProtect.consumeQuickAddTodo().then((pending) => pending && inputRef.current?.focus());
  }, []);
  useEffect(() => window.eyeProtect.onPanelBlur(() => {
    if (dirty) {
      setNudge(true);
    } else {
      void window.eyeProtect.closePanel();
    }
  }), [dirty]);

  const addTask = (event: FormEvent): void => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) {
      return;
    }
    void window.eyeProtect.createTask({ title, plannedAt: Date.now(), context: 'desk' }).then(() => {
      setDraft('');
      setNudge(false);
      inputRef.current?.focus();
    });
  };

  const paused = reminder.pausedUntil !== null && reminder.pausedUntil > now;

  return (
    <main className="panel-shell quick-panel-shell">
      <header className="panel-header quick-panel-header">
        <div>
          <strong>今天</strong>
          <span>{today.length} 项优先任务</span>
        </div>
        <button type="button" title="关闭" aria-label="关闭" onClick={() => {
          if (dirty) {
            setNudge(true);
          } else {
            void window.eyeProtect.closePanel();
          }
        }}>
          <X size={15} />
        </button>
      </header>

      {nudge ? <span className="panel-nudge">请先添加任务或清空输入内容</span> : null}

      <section className="quick-rhythm-card">
        <div><Eye size={15} /><span>护眼</span><strong>{paused ? '已暂停' : minutesLeft(reminder.nextEyeAt, now)}</strong></div>
        <div><Footprints size={15} /><span>走动</span><strong>{paused ? formatClock(reminder.pausedUntil!) : minutesLeft(reminder.nextWalkAt, now)}</strong></div>
        <button type="button" onClick={() => void (paused ? window.eyeProtect.resume() : window.eyeProtect.pause(10))}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? '恢复' : '暂停 10 分钟'}
        </button>
      </section>

      <form className="quick-add-task" onSubmit={addTask}>
        <input
          ref={inputRef}
          value={draft}
          maxLength={TASK_TITLE_MAX}
          placeholder="快速添加今天的任务…"
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setNudge(false);
          }}
        />
        <button type="submit" disabled={!draft.trim()} aria-label="添加任务"><Plus size={15} /></button>
      </form>

      <ul className="quick-task-list">
        {today.map((task) => (
          <li key={task.id}>
            <button type="button" aria-label={`完成 ${task.title}`} onClick={() => void window.eyeProtect.setTaskStatus(task.id, 'done')}>
              <Check size={12} />
            </button>
            <span>{task.title}</span>
            <small>{task.priority === 'urgent' ? '紧急' : task.priority === 'important' ? '重要' : ''}</small>
          </li>
        ))}
        {today.length === 0 ? <li className="quick-empty">今天还没有任务，先添加一件吧。</li> : null}
      </ul>

      <button className="quick-open-workbench" type="button" onClick={() => void window.eyeProtect.openWorkbench('today')}>
        打开完整工作台
      </button>
    </main>
  );
}
