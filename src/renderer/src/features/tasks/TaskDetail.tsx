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
import { useProjectSections } from '../../hooks/useProjectSections';
import { commands } from '../../lib/commands';
import styles from './TaskDetail.module.css';

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

/**
 * True when an autosave draft carries no change relative to the persisted
 * task. Used to skip no-op flushes on blur/unmount so closing the detail
 * pane never fires a redundant write.
 */
const draftEqualsTask = (draft: TaskUpdateInput, source: Task): boolean =>
  draft.title === source.title &&
  (draft.notes ?? null) === (source.notes ?? null) &&
  draft.priority === source.priority &&
  draft.context === source.context &&
  draft.remindOnBreak === source.remindOnBreak &&
  draft.projectId === source.projectId &&
  draft.sectionId === source.sectionId &&
  draft.parentId === source.parentId &&
  draft.plannedAt === source.plannedAt &&
  draft.dueAt === source.dueAt &&
  draft.reminderAt === source.reminderAt &&
  draft.estimateMinutes === source.estimateMinutes &&
  JSON.stringify(draft.tags ?? []) === JSON.stringify(source.tags);

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
  const [sectionId, setSectionId] = useState<string | null>(task.sectionId);
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
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskRef = useRef(task);
  taskRef.current = task;
  // Local revision guard (USERPLAN PR2): the task revision this draft is based
  // on. Sent as `baseRevision` with every autosave/flush; the store rejects
  // the write when the row moved on, and we resync from the fresh server
  // state instead of clobbering it.
  const baseRevisionRef = useRef(task.revision);
  const latestDraftRef = useRef<TaskUpdateInput>({});
  latestDraftRef.current = {
    title: title.trim() || task.title,
    notes: notes.trim() || null,
    priority,
    context,
    remindOnBreak: context !== 'desk' && remindOnBreak,
    projectId,
    sectionId,
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
  const { sections: taskSections } = useProjectSections(projectId ?? '');
  const recurrenceCommand = useCommand(
    (rule: RecurrenceRule | null) => commands.tasks.update(task.id, { recurrence: rule })
  );

  // Status is controlled by list checkboxes as well as this detail pane. Keep
  // this one externally-owned field in sync without resetting dirty draft
  // fields (title/notes/etc.) that may still be waiting for autosave.
  useEffect(() => {
    setStatus(task.status);
  }, [task.id, task.status]);

  // Re-sync local state when the selected task changes (also used to recover
  // after a stale-write rejection).
  const resyncFieldsFrom = useCallback((source: Task): void => {
    setTitle(source.title);
    setNotes(source.notes ?? '');
    setPriority(source.priority);
    setContext(source.context);
    setRemindOnBreak(source.remindOnBreak);
    setProjectId(source.projectId);
    setSectionId(source.sectionId);
    setPlannedAt(toLocalInputValue(source.plannedAt ?? Date.now()));
    setDueAt(toLocalInputValue(source.dueAt ?? Date.now()));
    setReminderAt(toLocalInputValue(source.reminderAt ?? Date.now()));
    setHasPlanned(source.plannedAt !== null);
    setHasDue(source.dueAt !== null);
    setHasReminder(source.reminderAt !== null);
    setEstimateMinutes(String(source.estimateMinutes ?? ''));
    setTags(source.tags.join(', '));
    setRecurrenceType(parseRecurrenceType(source.recurrence));
    setRecurrenceInterval('interval' in (source.recurrence ?? {}) ? String((source.recurrence as { interval: number }).interval) : '1');
    setRecurrenceWeekdays(source.recurrence?.type === 'weekly' ? source.recurrence.weekdays : [new Date(source.reminderAt ?? source.dueAt ?? Date.now()).getDay()]);
    setMonthlyDay(source.recurrence?.type === 'monthly' ? source.recurrence.day : new Date(source.dueAt ?? Date.now()).getDate());
    setAfterDays(source.recurrence?.type === 'after-completion' ? source.recurrence.days : 1);
    setParentId(source.parentId);
    setStatus(source.status);
    baseRevisionRef.current = source.revision;
    initialSyncRef.current = true;
    setSaveError(null);
  }, []);

  useEffect(() => {
    resyncFieldsFrom(task);
    // Keyed by task id only: external updates to the SAME task must not wipe
    // a dirty draft; they reconcile via the revision guard instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Serialize autosave requests so rapid edits can't reorder behind a slow
  // round-trip. Each persist runs through the command layer and surfaces the
  // real error message instead of a generic string.
  const persist = useCallback((input: TaskUpdateInput): void => {
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const result = await update.run({ ...input, baseRevision: baseRevisionRef.current });
      if (result.ok) {
        const fresh = result.data.find((entry) => entry.id === taskRef.current.id);
        if (fresh) baseRevisionRef.current = fresh.revision;
        setSaveError(null);
        onUpdated?.();
      } else {
        if (result.code === 'conflict') {
          // Stale autosave: the server copy is newer. Drop the draft and
          // resync from the latest known state instead of overwriting.
          resyncFieldsFrom(taskRef.current);
        }
        setSaveError(result.message);
      }
    });
  }, [update.run, onUpdated, resyncFieldsFrom]);

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
  }, [title, priority, context, remindOnBreak, projectId, sectionId, parentId, plannedAt, dueAt, reminderAt, hasPlanned, hasDue, hasReminder, estimateMinutes, tags, task.title, persist]);

  useEffect(() => {
    if (initialSyncRef.current) return;
    notesTimerRef.current = setTimeout(() => {
      notesTimerRef.current = null;
      persist({ notes: notes.trim() || null });
    }, 500);
    return () => {
      if (notesTimerRef.current !== null) {
        clearTimeout(notesTimerRef.current);
        notesTimerRef.current = null;
      }
    };
  }, [notes, persist]);

  /**
   * Flush the latest draft without touching component state.
   *
   * USERPLAN 1.2 P0: closing the side sheet unmounts TaskDetail and cancels
   * the pending debounce timers, which used to lose up to 500ms of note
   * edits. The flush is enqueued on the SAME serialized save queue as the
   * debounced writes, so it always lands after them — the newest revision
   * wins and a stale autosave can never overwrite it.
   */
  const flushDraft = useCallback((): void => {
    const source = taskRef.current;
    const draft = { ...latestDraftRef.current };
    if (draftEqualsTask(draft, source)) return;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const result = await commands.tasks.update(source.id, { ...draft, baseRevision: baseRevisionRef.current });
      if (result.ok) {
        const fresh = result.data.find((entry) => entry.id === source.id);
        if (fresh) baseRevisionRef.current = fresh.revision;
      } else {
        // The component is usually unmounted at this point, so surface the
        // failure on the console instead of a dead setState. A stale flush is
        // intentionally dropped: the newer server copy wins.
        console.error(`[TaskDetail] draft flush failed for task ${source.id}: ${result.message}`);
      }
    });
  }, []);

  // Flush on unmount (side-sheet close) and on blur of the free-text fields.
  useEffect(() => flushDraft, [flushDraft]);

  const flushNotes = useCallback((): void => {
    if (notesTimerRef.current !== null) {
      clearTimeout(notesTimerRef.current);
      notesTimerRef.current = null;
    }
    flushDraft();
  }, [flushDraft]);

  return (
    <form className={`${styles.root} detail-card`} onSubmit={(event) => event.preventDefault()}>
      <div className="detail-header">
        <input
          className="detail-title-input"
          type="text"
          aria-label="任务标题"
          value={title}
          maxLength={TASK_TITLE_MAX}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onBlur={flushDraft}
        />
        <span className={`detail-save-state ${saveError ? 'is-error' : ''}`}>{saveError ?? '自动保存'}</span>
      </div>

      <label className="detail-field detail-notes-field">
        <span>备注</span>
        <textarea
          className="detail-notes"
          value={notes}
          rows={3}
          placeholder="添加备注..."
          onChange={(event) => setNotes(event.currentTarget.value)}
          onBlur={flushNotes}
        />
      </label>

      <section className="detail-section" aria-labelledby="detail-core-heading">
        <h2 id="detail-core-heading">属性</h2>
        <div className="detail-property-grid">
        <fieldset className="detail-field">
          <legend>优先级</legend>
          <div className="segmented">
          {(Object.keys(PRIORITY_LABELS) as TodoPriority[]).map((key) => (
            <button
              key={key}
              type="button"
              className={priority === key ? 'is-active' : ''}
              aria-pressed={priority === key}
              onClick={() => setPriority(key)}
            >
              <span className="detail-priority-swatch" data-priority={key} aria-hidden="true" />
              {PRIORITY_LABELS[key]}
            </button>
          ))}
          </div>
        </fieldset>

        <fieldset className="detail-field">
          <legend>上下文</legend>
          <div className="segmented">
          {(Object.keys(CONTEXT_LABELS) as TaskContext[]).map((key) => (
            <button
              key={key}
              type="button"
              className={context === key ? 'is-active' : ''}
              aria-pressed={context === key}
              onClick={() => {
                setContext(key);
                if (key === 'desk') setRemindOnBreak(false);
              }}
            >
              {CONTEXT_LABELS[key]}
            </button>
          ))}
          </div>
        </fieldset>

        {context !== 'desk' ? (
          <label className="task-break-option detail-break-option">
            <span className="detail-row-label">走动提醒</span>
            <input
              type="checkbox"
              checked={remindOnBreak}
              onChange={(event) => setRemindOnBreak(event.currentTarget.checked)}
            />
            <span>在走动休息时提醒我顺手完成</span>
          </label>
        ) : null}

        <label className="detail-field">
          <span>项目</span>
        <select value={projectId ?? ''} onChange={(event) => {
          setProjectId(event.currentTarget.value || null);
          setSectionId(null);
        }}>
          <option value="">无</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        </label>

        <label className="detail-field">
          <span>项目分组</span>
        <select
          value={sectionId ?? ''}
          disabled={!projectId || taskSections.length === 0 || update.isPending}
          onChange={(event) => setSectionId(event.currentTarget.value || null)}
        >
          <option value="">未分组</option>
          {taskSections.map((section) => (
            <option key={section.id} value={section.id}>{section.name}</option>
          ))}
        </select>
        </label>

        <fieldset className="detail-field detail-field-wide">
          <legend>状态</legend>
          <div className="segmented">
          {STATUS_OPTIONS.map((key) => (
            <button
              key={key}
              type="button"
              className={status === key ? 'is-active' : ''}
              aria-pressed={status === key}
              disabled={statusCommand.isPending}
              onClick={() => {
                setStatus(key);
                void statusCommand.run(key).then((result) => {
                  if (result.ok) {
                    setSaveError(null);
                  } else {
                    // Roll back the optimistic flip: the store stayed at the
                    // old status, so the UI must not keep lying about it.
                    setStatus(taskRef.current.status);
                    setSaveError(result.message);
                  }
                });
              }}
            >
              {STATUS_LABELS[key]}
            </button>
          ))}
          </div>
        </fieldset>
        </div>
      </section>

      <section className="detail-section" aria-labelledby="detail-time-heading">
        <h2 id="detail-time-heading">时间</h2>
        <div className="detail-field-row">
        <div className="detail-field">
          <label htmlFor="detail-planned-at"><Clock3 size={12} />计划时间</label>
          {hasPlanned ? (
            <input
              id="detail-planned-at"
              type="datetime-local"
              value={plannedAt}
              onChange={(event) => setPlannedAt(event.currentTarget.value)}
            />
          ) : (
            <button id="detail-planned-at" type="button" className="detail-empty-value" onClick={() => setHasPlanned(true)} aria-label="启用计划时间">—</button>
          )}
          <label className="detail-check">
            <input type="checkbox" checked={hasPlanned} onChange={(event) => setHasPlanned(event.currentTarget.checked)} />
            <span>启用</span>
          </label>
        </div>
        <div className="detail-field">
          <label htmlFor="detail-due-at"><Clock3 size={12} />截止时间</label>
          {hasDue ? (
            <input
              id="detail-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.currentTarget.value)}
            />
          ) : (
            <button id="detail-due-at" type="button" className="detail-empty-value" onClick={() => setHasDue(true)} aria-label="启用截止时间">—</button>
          )}
          <label className="detail-check">
            <input type="checkbox" checked={hasDue} onChange={(event) => setHasDue(event.currentTarget.checked)} />
            <span>启用</span>
          </label>
        </div>
        </div>

        <div className="detail-field">
        <label htmlFor="detail-reminder-at"><Clock3 size={12} />提醒时间</label>
        {hasReminder ? (
          <input id="detail-reminder-at" type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.currentTarget.value)} />
        ) : (
          <button id="detail-reminder-at" type="button" className="detail-empty-value" onClick={() => setHasReminder(true)} aria-label="启用提醒时间">—</button>
        )}
        <label className="detail-check"><input type="checkbox" checked={hasReminder} onChange={(event) => setHasReminder(event.currentTarget.checked)} /><span>启用</span></label>
        </div>

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
      </section>

      <details className="detail-advanced">
        <summary>更多</summary>
        <div className="detail-advanced-body">
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
          {WEEKDAY_LABELS.map((label, day) => <button key={label} type="button" className={recurrenceWeekdays.includes(day) ? 'is-active' : ''} aria-pressed={recurrenceWeekdays.includes(day)} onClick={() => setRecurrenceWeekdays((current) => current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort())}>{label}</button>)}
        </div>
      ) : null}
      {recurrenceType === 'monthly' ? <label className="detail-field"><span>每月日期</span><input type="number" min={1} max={31} value={monthlyDay} onChange={(event) => setMonthlyDay(Math.min(31, Math.max(1, Number(event.currentTarget.value) || 1)))} /></label> : null}
      {recurrenceType === 'after-completion' ? <label className="detail-field"><span>完成后天数</span><input type="number" min={1} max={365} value={afterDays} onChange={(event) => setAfterDays(Math.max(1, Number(event.currentTarget.value) || 1))} /></label> : null}
        </div>
      </details>

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
