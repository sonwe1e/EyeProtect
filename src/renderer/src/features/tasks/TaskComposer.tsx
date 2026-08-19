import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import {
  TASK_TITLE_MAX,
  type Project,
  type Task,
  type TaskContext,
  type TaskInput,
  type TodoPriority
} from '../../../../shared/types';
import { isProjectAssignable } from '../../../../shared/projectPolicy';
import { CommandButton } from '../../components/CommandButton';
import { DateTimeField, Field, Select } from '../../components/primitives';
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

export type TaskCreationPlacement =
  | { type: 'inbox' }
  | { type: 'today'; localDate: string }
  | { type: 'project'; projectId: string };

/** Quick-add form: title + submit always visible; extra fields in an expandable
 *  area so the common path (type + Enter) stays fast. Creating a task goes
 *  through the command layer so a failure (e.g. read-only database) surfaces on
 *  the button instead of being silently swallowed. */
export function TaskComposer({ projects, tasks, placement, onCreated }: {
  projects: Project[];
  tasks: Task[];
  placement: TaskCreationPlacement;
  onCreated?: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState<TodoPriority>('normal');
  const [context, setContext] = useState<TaskContext>('desk');
  const [remindOnBreak, setRemindOnBreak] = useState(false);
  const initialProjectId = placement.type === 'project' ? placement.projectId : null;
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [dueAt, setDueAt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const create = useCommand(async ({ input, existingIds }: { input: TaskInput; existingIds: string[] }) => {
    const result = await commands.tasks.create(input);
    if (!result.ok || placement.type !== 'today') return result;
    const before = new Set(existingIds);
    const created = result.data.find((task) => !before.has(task.id));
    if (!created) {
      return {
        ok: false as const,
        code: 'unknown' as const,
        message: '任务已创建，但无法将它加入今天。请在“未归类”中确认任务后重试。',
        recoverable: true
      };
    }
    const planResult = await commands.planning.upsert({
      taskId: created.id,
      localDate: placement.localDate,
      plannedMinutes: created.estimateMinutes,
      dailyRank: null
    });
    return planResult.ok ? result : planResult;
  });

  const reset = useCallback(() => {
    setDraft('');
    setPriority('normal');
    setContext('desk');
    setRemindOnBreak(false);
    setProjectId(initialProjectId);
    setDueAt('');
    setExpanded(false);
    inputRef.current?.focus();
  }, [initialProjectId]);

  const assignableProjects = projects.filter(isProjectAssignable);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const title = draft.trim();
      if (!title) {
        return;
      }
      const input: TaskInput = {
        title,
        priority,
        context,
        remindOnBreak: context !== 'desk' && remindOnBreak,
        projectId: placement.type === 'inbox'
          ? null
          : placement.type === 'project'
            ? placement.projectId
            : projectId
      };
      if (dueAt) {
        input.dueAt = new Date(dueAt).getTime();
      }
      void create.run({ input, existingIds: tasks.map((task) => task.id) }).then((result) => {
        if (result.ok) {
          reset();
          onCreated?.();
        }
      });
    },
    [draft, priority, context, remindOnBreak, projectId, dueAt, reset, onCreated, create, placement, tasks]
  );

  return (
    <form className="task-composer" onSubmit={submit}>
      <div className="task-compose-row">
        <input
          ref={inputRef}
          data-quick-add="true"
          type="text"
          placeholder="添加任务，回车快速创建..."
          value={draft}
          maxLength={TASK_TITLE_MAX}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <button
          type="button"
          className="task-composer-toggle"
          title={expanded ? '收起选项' : '更多选项'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <CommandButton
          type="submit"
          state={create.state}
          errorReason={create.error?.message}
          disabled={!draft.trim()}
        >
          <Plus size={14} />
          <span>添加</span>
        </CommandButton>
      </div>
      {expanded ? (
        <div className="task-compose-extra">
          <label className="task-compose-field">
            <span>优先级</span>
            <div className="segmented">
              {(Object.keys(PRIORITY_LABELS) as TodoPriority[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={priority === key ? 'is-active' : ''}
                  aria-pressed={priority === key}
                  onClick={() => setPriority(key)}
                >
                  {PRIORITY_LABELS[key]}
                </button>
              ))}
            </div>
          </label>
          <label className="task-compose-field">
            <span>上下文</span>
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
          </label>
          <label className="task-break-option">
            <input
              type="checkbox"
              checked={remindOnBreak}
              disabled={context === 'desk'}
              onChange={(event) => setRemindOnBreak(event.currentTarget.checked)}
            />
            <span>休息时提醒</span>
          </label>
          {placement.type === 'today' ? (
            <Field className="task-compose-field" label="项目">
              <Select value={projectId ?? ''} onChange={(event) => setProjectId(event.currentTarget.value || null)}>
                <option value="">无（保留在“未归类”）</option>
                {assignableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field className="task-compose-field" label="截止日期">
            <DateTimeField value={dueAt} onChange={(event) => setDueAt(event.currentTarget.value)} />
          </Field>
        </div>
      ) : null}
    </form>
  );
}
