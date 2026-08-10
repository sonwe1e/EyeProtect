import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, Play, Repeat, Square, Tags, Trash2 } from 'lucide-react';
import {
  TASK_TITLE_MAX,
  type Project,
  type RecurrenceRule,
  type Task,
  type TaskContext,
  type TaskStatus,
  type TaskUpdateInput,
  type TodoPriority
} from '../../../../shared/types';
import { CommandButton } from '../../components/CommandButton';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';

const PRIORITY_LABELS: Record<TodoPriority, string> = {
  normal: '普通',
  important: '重要',
  urgent: '紧急'
};

const CONTEXT_LABELS: Record<TaskContext, string> = {
  desk: '桌面',
  away: '外出',
  any: '任意'
};

const STATUS_OPTIONS: TaskStatus[] = ['open', 'done', 'archived'];
const STATUS_LABELS: Record<TaskStatus, string> = {
  open: '未完成',
  done: '已完成',
  archived: '已归档'
};

const RECURRENCE_TYPES = ['none', 'daily', 'weekly', 'monthly', 'after-completion'] as const;
type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: '不重复',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  'after-completion': '完成后'
};
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

/** datetime-local inputs expect a value in the form YYYY-MM-DDTHH:mm (local). */
const toLocalInputValue = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
};

const parseRecurrenceType = (rule: RecurrenceRule | null): RecurrenceType =>
  rule ? (rule.type as RecurrenceType) : 'none';

const buildRecurrence = (
  type: RecurrenceType,
  interval: number,
  weekdays: number[],
  monthlyDay: number,
  afterDays: number
): RecurrenceRule | null => {
  switch (type) {
    case 'daily':
      return { type: 'daily', interval };
    case 'weekly':
      return weekdays.length ? { type: 'weekly', interval, weekdays } : null;
    case 'monthly':
      return { type: 'monthly', interval, day: monthlyDay };
    case 'after-completion':
      return { type: 'after-completion', days: afterDays };
    default:
      return null;
  }
};

export function TaskDetail({ task, projects, tasks = [], active = false, onUpdated, onDeleted }: {
  task: Task;
  projects: Project[];
  tasks?: Task[];
  active?: boolean;
  onUpdated?: () => void;
  onDeleted?: () => void;
}): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [priority, setPriority] = useState<TodoPriority>(task.priority);
  const [context, setContext] = useState<TaskContext>(task.context);
  const [remindOnBreak, setRemindOnBreak] = useState(task.remindOnBreak);
  const [projectId, setProjectId] = useState<string | null>(task.projectId);
  const [plannedAt, setPlannedAt] = useState(toLocalInputValue(task.plannedAt ?? Date.now()));
  const [dueAt, setDueAt] = useState(toLocalInputValue(task.dueAt ?? Date.now()));
  const [reminderAt, setReminderAt] = useState(toLocalInputValue(task.reminderAt ?? Date.now()));
  const [hasPlanned, setHasPlanned] = useState(task.plannedAt !== null);
  const [hasDue, setHasDue] = useState(task.dueAt !== null);
  const [hasReminder, setHasReminder] = useState(task.reminderAt !== null);
  const [estimateMinutes, setEstimateMinutes] = useState(String(task.estimateMinutes ?? ''));
  const [tags, setTags] = useState(task.tags.join(', '));
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(parseRecurrenceType(task.recurrence));
  const [recurrenceInterval, setRecurrenceInterval] = useState('interval' in (task.recurrence ?? {}) ? String((task.recurrence as { interval: number }).interval) : '1');
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState(task.recurrence?.type === 'weekly' ? task.recurrence.weekdays : [new Date(task.reminderAt ?? task.dueAt ?? Date.now()).getDay()]);
  const [monthlyDay, setMonthlyDay] = useState(task.recurrence?.type === 'monthly' ? task.recurrence.day : new Date(task.dueAt ?? Date.now()).getDate());
  const [afterDays, setAfterDays] = useState(task.recurrence?.type === 'after-completion' ? task.recurrence.days : 1);
  const [parentId, setParentId] = useState(task.parentId);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const initialSyncRef = useRef(true);
  const latestDraftRef = useRef<TaskUpdateInput>({});
  latestDraftRef.current = {
    title: title.trim() || task.title,
    notes: notes.trim() || null,
    priority,
    context,
    remindOnBreak: context !== 'desk' && remindOnBreak,
    projectId,
    parentId,
    plannedAt: hasPlanned ? new Date(plannedAt).getTime() : null,
    dueAt: hasDue ? new Date(dueAt).getTime() : null,
    reminderAt: hasReminder ? new Date(reminderAt).getTime() : null,
    estimateMinutes: estimateMinutes ? Number(estimateMinutes) : null,
    tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  };

  // Field-group edits share one command. The command identity is pinned to the
  // task id so its `run` stays stable across renders and the debounce effects
  // below don't reset on every keystroke.
  const updateCommand = useCallback(
    (input: TaskUpdateInput) => commands.tasks.update(task.id, input),
    [task.id]
  );
  const update = useCommand(updateCommand);

  const statusCommand = useCommand((next: TaskStatus) => commands.tasks.setStatus(task.id, next));
  const activeCommand = useCommand((id: string | null) => commands.tasks.setActive(id));
  const deleteCommand = useCommand(() => commands.tasks.delete(task.id));
  const recurrenceCommand = useCommand(
    (rule: RecurrenceRule | null) => commands.tasks.update(task.id, { recurrence: rule })
  );

  // Status is controlled by list checkboxes as well as this detail pane. Keep
  // this one externally-owned field in sync without resetting dirty draft
  // fields (title/notes/etc.) that may still be waiting for autosave.
  useEffect(() => {
    setStatus(task.status);
  }, [task.id, task.status]);

  // Re-sync local state when the selected task changes.
  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes ?? '');
    setPriority(task.priority);
    setContext(task.context);
    setRemindOnBreak(task.remindOnBreak);
    setProjectId(task.projectId);
    setPlannedAt(toLocalInputValue(task.plannedAt ?? Date.now()));
    setDueAt(toLocalInputValue(task.dueAt ?? Date.now()));
    setReminderAt(toLocalInputValue(task.reminderAt ?? Date.now()));
    setHasPlanned(task.plannedAt !== null);
    setHasDue(task.dueAt !== null);
    setHasReminder(task.reminderAt !== null);
    setEstimateMinutes(String(task.estimateMinutes ?? ''));
    setTags(task.tags.join(', '));
    setRecurrenceType(parseRecurrenceType(task.recurrence));
    setRecurrenceInterval('interval' in (task.recurrence ?? {}) ? String((task.recurrence as { interval: number }).interval) : '1');
    setRecurrenceWeekdays(task.recurrence?.type === 'weekly' ? task.recurrence.weekdays : [new Date(task.reminderAt ?? task.dueAt ?? Date.now()).getDay()]);
    setMonthlyDay(task.recurrence?.type === 'monthly' ? task.recurrence.day : new Date(task.dueAt ?? Date.now()).getDate());
    setAfterDays(task.recurrence?.type === 'after-completion' ? task.recurrence.days : 1);
    setParentId(task.parentId);
    setStatus(task.status);
    initialSyncRef.current = true;
    setSaveError(null);
  }, [task.id]);

  // Serialize autosave requests so rapid edits can't reorder behind a slow
  // round-trip. Each persist runs through the command layer and surfaces the
  // real error message instead of a generic string.
  const persist = useCallback((input: TaskUpdateInput): void => {
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const result = await update.run(input);
      if (result.ok) {
        setSaveError(null);
        onUpdated?.();
      } else {
        setSaveError(result.message);
      }
    });
  }, [update.run, onUpdated]);

  useEffect(() => {
    if (initialSyncRef.current) {
      initialSyncRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const { notes: _notes, ...input } = latestDraftRef.current;
      persist(input);
    }, 0);
    return () => clearTimeout(timer);
  }, [title, priority, context, remindOnBreak, projectId, parentId, plannedAt, dueAt, reminderAt, hasPlanned, hasDue, hasReminder, estimateMinutes, tags, task.title, persist]);

  useEffect(() => {
    if (initialSyncRef.current) return;
    const timer = setTimeout(() => persist({ notes: notes.trim() || null }), 500);
    return () => clearTimeout(timer);
  }, [notes, persist]);

  return (
    <form className="detail-card" onSubmit={(event) => event.preventDefault()}>
      <div className="detail-header">
        <input
          className="detail-title-input"
          type="text"
          value={title}
          maxLength={TASK_TITLE_MAX}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <span className={`detail-save-state ${saveError ? 'is-error' : ''}`}>{saveError ?? '自动保存'}</span>
      </div>

      <label className="detail-field">
        <span>备注</span>
        <textarea
          className="detail-notes"
          value={notes}
          rows={3}
          placeholder="添加备注..."
          onChange={(event) => setNotes(event.currentTarget.value)}
        />
      </label>

      <label className="detail-field">
        <span>优先级</span>
        <div className="segmented">
          {(Object.keys(PRIORITY_LABELS) as TodoPriority[]).map((key) => (
            <button
              key={key}
              type="button"
              className={priority === key ? 'is-active' : ''}
              onClick={() => setPriority(key)}
            >
              {PRIORITY_LABELS[key]}
            </button>
          ))}
        </div>
      </label>

      <label className="detail-field">
        <span>上下文</span>
        <div className="segmented">
          {(Object.keys(CONTEXT_LABELS) as TaskContext[]).map((key) => (
            <button
              key={key}
              type="button"
              className={context === key ? 'is-active' : ''}
              onClick={() => {
                setContext(key);
                if (key === 'desk') setRemindOnBreak(false);
              }}
            >
              {CONTEXT_LABELS[key]}
            </button>
          ))}
        </div>
      </label>

      <label className="task-break-option detail-break-option">
        <input
          type="checkbox"
          checked={remindOnBreak}
          disabled={context === 'desk'}
          onChange={(event) => setRemindOnBreak(event.currentTarget.checked)}
        />
        <span>在走动休息时提醒我顺手完成</span>
      </label>

      <label className="detail-field">
        <span>项目</span>
        <select value={projectId ?? ''} onChange={(event) => setProjectId(event.currentTarget.value || null)}>
          <option value="">无</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <label className="detail-field">
        <span>父任务</span>
        <select value={parentId ?? ''} onChange={(event) => setParentId(event.currentTarget.value || null)}>
          <option value="">无</option>
          {tasks.filter((candidate) => candidate.id !== task.id && candidate.parentId !== task.id).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
          ))}
        </select>
      </label>

      <label className="detail-field">
        <span>状态</span>
        <div className="segmented">
          {STATUS_OPTIONS.map((key) => (
            <button
              key={key}
              type="button"
              className={status === key ? 'is-active' : ''}
              disabled={statusCommand.isPending}
              onClick={() => {
                setStatus(key);
                void statusCommand.run(key).then((result) => {
                  if (result.ok) {
                    setSaveError(null);
                  } else {
                    setSaveError(result.message);
                  }
                });
              }}
            >
              {STATUS_LABELS[key]}
            </button>
          ))}
        </div>
      </label>

      <div className="detail-field-row">
        <label className="detail-field">
          <span>
            <Clock3 size={12} />
            计划时间
          </span>
          <input
            type="datetime-local"
            disabled={!hasPlanned}
            value={hasPlanned ? plannedAt : ''}
            onChange={(event) => setPlannedAt(event.currentTarget.value)}
          />
          <label className="detail-check">
            <input type="checkbox" checked={hasPlanned} onChange={(event) => setHasPlanned(event.currentTarget.checked)} />
            <span>启用</span>
          </label>
        </label>
        <label className="detail-field">
          <span>
            <Clock3 size={12} />
            截止时间
          </span>
          <input
            type="datetime-local"
            disabled={!hasDue}
            value={hasDue ? dueAt : ''}
            onChange={(event) => setDueAt(event.currentTarget.value)}
          />
          <label className="detail-check">
            <input type="checkbox" checked={hasDue} onChange={(event) => setHasDue(event.currentTarget.checked)} />
            <span>启用</span>
          </label>
        </label>
      </div>

      <label className="detail-field">
        <span><Clock3 size={12} />提醒时间</span>
        <input type="datetime-local" disabled={!hasReminder} value={hasReminder ? reminderAt : ''} onChange={(event) => setReminderAt(event.currentTarget.value)} />
        <label className="detail-check"><input type="checkbox" checked={hasReminder} onChange={(event) => setHasReminder(event.currentTarget.checked)} /><span>启用</span></label>
      </label>

      <label className="detail-field">
        <span>预估时长（分钟）</span>
        <input
          type="number"
          min={0}
          step={5}
          inputMode="numeric"
          value={estimateMinutes}
          placeholder="—"
          onChange={(event) => setEstimateMinutes(event.currentTarget.value)}
        />
      </label>

      <label className="detail-field">
        <span>
          <Tags size={12} />
          标签
        </span>
        <input
          type="text"
          value={tags}
          placeholder="用逗号分隔"
          onChange={(event) => setTags(event.currentTarget.value)}
        />
      </label>

      <label className="detail-field">
        <span>
          <Repeat size={12} />
          重复
        </span>
        <select value={recurrenceType} onChange={(event) => setRecurrenceType(event.currentTarget.value as RecurrenceType)}>
          {RECURRENCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {RECURRENCE_LABELS[type]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="detail-recurrence-apply"
          disabled={recurrenceCommand.isPending}
          onClick={() => {
            void recurrenceCommand.run(
              buildRecurrence(recurrenceType, Math.max(1, Number(recurrenceInterval) || 1), recurrenceWeekdays, monthlyDay, afterDays)
            ).then((result) => {
              if (result.ok) {
                setSaveError(null);
              } else {
                setSaveError(result.message);
              }
            });
          }}
        >应用重复规则</button>
      </label>

      {recurrenceType === 'daily' || recurrenceType === 'weekly' || recurrenceType === 'monthly' ? (
        <label className="detail-field"><span>重复间隔</span><input type="number" min={1} max={365} value={recurrenceInterval} onChange={(event) => setRecurrenceInterval(event.currentTarget.value)} /></label>
      ) : null}
      {recurrenceType === 'weekly' ? (
        <div className="weekday-picker">
          {WEEKDAY_LABELS.map((label, day) => <button key={label} type="button" className={recurrenceWeekdays.includes(day) ? 'is-active' : ''} onClick={() => setRecurrenceWeekdays((current) => current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort())}>{label}</button>)}
        </div>
      ) : null}
      {recurrenceType === 'monthly' ? <label className="detail-field"><span>每月日期</span><input type="number" min={1} max={31} value={monthlyDay} onChange={(event) => setMonthlyDay(Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)))} /></label> : null}
      {recurrenceType === 'after-completion' ? <label className="detail-field"><span>完成后天数</span><input type="number" min={1} max={365} value={afterDays} onChange={(event) => setAfterDays(Math.max(1, Number(event.currentTarget.value) || 1))} /></label> : null}

      <div className="detail-footer">
        <span className="detail-timestamps">
          创建 {dateFormatter.format(new Date(task.createdAt))} · 更新{' '}
          {dateFormatter.format(new Date(task.updatedAt))}
        </span>
        <CommandButton
          type="button"
          className="detail-active"
          state={activeCommand.state}
          errorReason={activeCommand.error?.message}
          onClick={() => {
            void activeCommand.run(active ? null : task.id);
          }}
        >
          {active ? <Square size={13} /> : <Play size={13} />}
          <span>{active ? '停止任务' : '开始任务'}</span>
        </CommandButton>
        <CommandButton
          type="button"
          className="detail-delete"
          state={deleteCommand.state}
          errorReason={deleteCommand.error?.message}
          onClick={() => {
            void deleteCommand.run().then((result) => {
              if (result.ok) {
                onDeleted?.();
              }
            });
          }}
        >
          <Trash2 size={13} />
          <span>删除</span>
        </CommandButton>
      </div>
    </form>
  );
}
