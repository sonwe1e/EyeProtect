import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Footprints, Globe, Monitor, Trash2 } from 'lucide-react';
import {
  TASK_TITLE_MAX,
  nextTodoPriority,
  type Project,
  type Task,
  type TaskStatus,
  type TaskUpdateInput,
  type TaskView,
  type TodoPriority
} from '../../../../shared/types';

const TASK_CONFIRM_RESET_MS = 2500;

const PRIORITY_LABELS: Record<TodoPriority, string> = {
  normal: '普通',
  important: '重要',
  urgent: '紧急'
};

const STATUS_LABELS: Record<string, string> = {
  inbox: '收件箱',
  active: '进行中',
  done: '已完成',
  archived: '已归档'
};

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric'
});

const formatDue = (timestamp: number): string => shortDateFormatter.format(new Date(timestamp));

const formatDateTime = (timestamp: number): string => dateFormatter.format(new Date(timestamp));

const isToday = (timestamp: number, now: number): boolean => {
  const a = new Date(timestamp);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

const contextIcon = (context: Task['context']) => {
  switch (context) {
    case 'away':
      return <Footprints size={11} />;
    case 'desk':
      return <Monitor size={11} />;
    default:
      return <Globe size={11} />;
  }
};

const contextLabel: Record<Task['context'], string> = {
  desk: '桌面',
  away: '外出',
  any: '任意'
};

export function TaskList({
  tasks,
  view,
  projects,
  now,
  selectedTaskId,
  onSelect,
  onStatusChange,
  onUpdate,
  onDelete,
  onPriorityChange
}: {
  tasks: Task[];
  view: TaskView;
  projects: Project[];
  now: number;
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, input: TaskUpdateInput) => void;
  onDelete: (id: string) => void;
  onPriorityChange: (id: string, priority: TodoPriority) => void;
}): JSX.Element {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  const projectById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of projects) {
      map.set(project.id, project);
    }
    return map;
  }, [projects]);

  const { orderedTasks, depthById } = useMemo(() => {
    const ids = new Set(tasks.map((task) => task.id));
    const children = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const task of tasks) {
      if (task.parentId && ids.has(task.parentId)) {
        children.set(task.parentId, [...(children.get(task.parentId) ?? []), task]);
      } else {
        roots.push(task);
      }
    }
    const ordered: Task[] = [];
    const depths = new Map<string, number>();
    const visited = new Set<string>();
    const visit = (task: Task, depth: number): void => {
      if (visited.has(task.id)) {
        return;
      }
      visited.add(task.id);
      ordered.push(task);
      depths.set(task.id, depth);
      for (const child of children.get(task.id) ?? []) {
        visit(child, depth + 1);
      }
    };
    roots.forEach((task) => visit(task, 0));
    tasks.forEach((task) => visit(task, 0));
    return { orderedTasks: ordered, depthById: depths };
  }, [tasks]);

  const moveTask = useCallback((index: number, direction: -1 | 1) => {
    const task = orderedTasks[index];
    const neighbor = orderedTasks[index + direction];
    if (!task || !neighbor) {
      return;
    }
    if (task.sortOrder === neighbor.sortOrder) {
      onUpdate(task.id, { sortOrder: Math.max(0, index + direction) });
      onUpdate(neighbor.id, { sortOrder: Math.max(0, index) });
      return;
    }
    onUpdate(task.id, { sortOrder: neighbor.sortOrder });
    onUpdate(neighbor.id, { sortOrder: task.sortOrder });
  }, [orderedTasks, onUpdate]);

  const handleRemoveClick = useCallback(
    (id: string) => {
      if (confirmingId === id) {
        if (confirmTimerRef.current) {
          clearTimeout(confirmTimerRef.current);
          confirmTimerRef.current = null;
        }
        setConfirmingId(null);
        onDelete(id);
        return;
      }
      setConfirmingId(id);
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
      confirmTimerRef.current = setTimeout(() => setConfirmingId(null), TASK_CONFIRM_RESET_MS);
    },
    [confirmingId, onDelete]
  );

  const startEdit = useCallback((task: Task) => {
    setEditingId(task.id);
    setEditText(task.title);
  }, []);

  const commitEdit = useCallback(() => {
    if (editingId === null) {
      return;
    }
    const text = editText.trim();
    if (text) {
      onUpdate(editingId, { title: text });
    }
    setEditingId(null);
    setEditText('');
  }, [editingId, editText, onUpdate]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const toggleStatus = useCallback(
    (task: Task) => {
      const next: TaskStatus = task.status === 'done' ? 'inbox' : 'done';
      onStatusChange(task.id, next);
    },
    [onStatusChange]
  );

  if (tasks.length === 0) {
    return <p className="task-empty empty-state">这里还没有任务，添加一件吧。</p>;
  }

  return (
    <ul className="task-list">
      {orderedTasks.map((task, index) => {
        const project = task.projectId ? projectById.get(task.projectId) : undefined;
        const overdue =
          (task.dueAt !== null && task.dueAt < new Date(now).setHours(0, 0, 0, 0)) ||
          (task.plannedAt !== null && task.plannedAt < new Date(now).setHours(0, 0, 0, 0));
        return (
          <li
            key={task.id}
            className={`task-row ${selectedTaskId === task.id ? 'is-selected' : ''} ${task.status === 'done' ? 'is-done' : ''}`.trim()}
            style={{ ['--task-depth' as string]: depthById.get(task.id) ?? 0 }}
            onClick={() => onSelect(task.id)}
          >
            <button
              type="button"
              className="task-priority-dot"
              data-priority={task.priority}
              title={`优先级：${PRIORITY_LABELS[task.priority]}（点击切换）`}
              aria-label={`优先级：${PRIORITY_LABELS[task.priority]}`}
              onClick={(event) => {
                event.stopPropagation();
                onPriorityChange(task.id, nextTodoPriority(task.priority));
              }}
            />
            <button
              type="button"
              className="task-checkbox"
              title={task.status === 'done' ? '标记为未完成' : '标记为完成'}
              aria-pressed={task.status === 'done'}
              onClick={(event) => {
                event.stopPropagation();
                toggleStatus(task);
              }}
            >
              {task.status === 'done' ? <Check size={11} /> : null}
            </button>
            <div className="task-main">
              {editingId === task.id ? (
                <input
                  className="task-edit-input"
                  type="text"
                  autoFocus
                  value={editText}
                  maxLength={TASK_TITLE_MAX}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setEditText(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitEdit();
                    } else if (event.key === 'Escape') {
                      event.stopPropagation();
                      cancelEdit();
                    }
                  }}
                  onBlur={commitEdit}
                />
              ) : (
                <span
                  className="task-title"
                  title={`${task.title}（双击编辑）`}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    startEdit(task);
                  }}
                >
                  {task.title}
                </span>
              )}
              <div className="task-meta">
                {task.dueAt !== null ? (
                  <span className={`task-due ${overdue && task.status !== 'done' ? 'is-overdue' : ''}`}>
                    {isToday(task.dueAt, now) ? formatDateTime(task.dueAt) : `截止 ${formatDue(task.dueAt)}`}
                  </span>
                ) : task.plannedAt !== null ? (
                  <span className={`task-due ${overdue && task.status !== 'done' ? 'is-overdue' : ''}`}>
                    {isToday(task.plannedAt, now) ? formatDateTime(task.plannedAt) : `计划 ${formatDue(task.plannedAt)}`}
                  </span>
                ) : null}
                <span className="context-tag" title={`上下文：${contextLabel[task.context]}`}>
                  {contextIcon(task.context)}
                  <span>{contextLabel[task.context]}</span>
                </span>
                {project ? (
                  <span className="project-chip" style={{ ['--chip-color' as string]: project.color ?? '#8aa0a6' }}>
                    <span className="project-chip-dot" />
                    <span>{project.name}</span>
                  </span>
                ) : null}
                {task.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="task-tag">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
            <span className="task-status-label">{STATUS_LABELS[task.status] ?? task.status}</span>
            <span className="task-order-controls">
              <button type="button" title="上移" aria-label={`上移「${task.title}」`} disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveTask(index, -1); }}><ArrowUp size={11} /></button>
              <button type="button" title="下移" aria-label={`下移「${task.title}」`} disabled={index === orderedTasks.length - 1} onClick={(event) => { event.stopPropagation(); moveTask(index, 1); }}><ArrowDown size={11} /></button>
            </span>
            {confirmingId === task.id ? (
              <button
                type="button"
                className="task-remove-confirm"
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemoveClick(task.id);
                }}
              >
                确认?
              </button>
            ) : (
              <button
                type="button"
                className="task-remove"
                title="删除"
                aria-label={`删除「${task.title}」`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemoveClick(task.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
