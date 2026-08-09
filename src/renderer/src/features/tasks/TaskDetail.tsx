import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Clock3, Play, Repeat, Save, Square, Tags, Trash2 } from 'lucide-react';
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

const STATUS_OPTIONS: TaskStatus[] = ['inbox', 'active', 'done', 'archived'];
const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: '收件箱',
  active: '进行中',
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setConfirmingDelete(false);
  }, [task]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  const handleSave = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const input: TaskUpdateInput = {
        title: title.trim() || task.title,
        notes: notes.trim() || null,
        priority,
        context,
        remindOnBreak: context !== 'desk' && remindOnBreak,
        projectId,
        parentId,
        estimateMinutes: estimateMinutes ? Number(estimateMinutes) : null,
        recurrence: buildRecurrence(recurrenceType, Math.max(1, Number(recurrenceInterval) || 1), recurrenceWeekdays, monthlyDay, afterDays),
        status,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      };
      if (hasPlanned) {
        input.plannedAt = new Date(plannedAt).getTime();
      } else {
        input.plannedAt = null;
      }
      if (hasDue) {
        input.dueAt = new Date(dueAt).getTime();
      } else {
        input.dueAt = null;
      }
      input.reminderAt = hasReminder ? new Date(reminderAt).getTime() : null;
      void window.eyeProtect.updateTask(task.id, input).then(() => onUpdated?.());
    },
    [title, notes, priority, context, remindOnBreak, projectId, parentId, plannedAt, dueAt, reminderAt, hasPlanned, hasDue, hasReminder, estimateMinutes, tags, recurrenceType, recurrenceInterval, recurrenceWeekdays, monthlyDay, afterDays, status, task, onUpdated]
  );

  const handleDelete = useCallback(() => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 2500);
      return;
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
    }
    setConfirmingDelete(false);
    void window.eyeProtect.deleteTask(task.id).then(() => onDeleted?.());
  }, [confirmingDelete, task.id, onDeleted]);

  return (
    <form className="detail-card" onSubmit={handleSave}>
      <div className="detail-header">
        <input
          className="detail-title-input"
          type="text"
          value={title}
          maxLength={TASK_TITLE_MAX}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <button type="submit" className="detail-save" title="保存">
          <Save size={14} />
          <span>保存</span>
        </button>
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
              onClick={() => setStatus(key)}
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
        <button type="button" className="detail-active" onClick={() => void window.eyeProtect.setActiveTask(active ? null : task.id)}>
          {active ? <Square size={13} /> : <Play size={13} />}
          <span>{active ? '停止任务' : '开始任务'}</span>
        </button>
        <button
          type="button"
          className={`detail-delete ${confirmingDelete ? 'is-confirm' : ''}`.trim()}
          onClick={handleDelete}
        >
          <Trash2 size={13} />
          <span>{confirmingDelete ? '确认删除?' : '删除'}</span>
        </button>
      </div>
    </form>
  );
}
