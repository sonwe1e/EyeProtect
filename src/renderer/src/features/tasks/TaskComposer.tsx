import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import {
  TASK_TITLE_MAX,
  type Project,
  type TaskContext,
  type TaskInput,
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

/** Quick-add form: title + submit always visible; extra fields in an expandable
 *  area so the common path (type + Enter) stays fast. Creating a task goes
 *  through the command layer so a failure (e.g. read-only database) surfaces on
 *  the button instead of being silently swallowed. */
export function TaskComposer({ projects, defaultProjectId, onCreated }: {
  projects: Project[];
  defaultProjectId?: string | null;
  onCreated?: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState<TodoPriority>('normal');
  const [context, setContext] = useState<TaskContext>('desk');
  const [remindOnBreak, setRemindOnBreak] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [dueAt, setDueAt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const create = useCommand((input: TaskInput) => commands.tasks.create(input));

  const reset = useCallback(() => {
    setDraft('');
    setPriority('normal');
    setContext('desk');
    setRemindOnBreak(false);
    setProjectId(defaultProjectId ?? null);
    setDueAt('');
    setExpanded(false);
    inputRef.current?.focus();
  }, [defaultProjectId]);

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
        projectId
      };
      if (dueAt) {
        input.dueAt = new Date(dueAt).getTime();
      }
      void create.run(input).then((result) => {
        if (result.ok) {
          reset();
          onCreated?.();
        }
      });
    },
    [draft, priority, context, remindOnBreak, projectId, dueAt, reset, onCreated, create]
  );

  return (
    <form className="task-composer" onSubmit={submit}>
      <div className="task-compose-row">
        <input
          ref={inputRef}
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
          <label className="task-compose-field">
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
          <label className="task-compose-field">
            <span>截止日期</span>
            <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.currentTarget.value)} />
          </label>
        </div>
      ) : null}
    </form>
  );
}
