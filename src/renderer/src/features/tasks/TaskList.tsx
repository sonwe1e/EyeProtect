import { useCallback, useMemo, useState } from 'react';
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
import { CommandButton } from '../../components/CommandButton';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';

const PRIORITY_LABELS: Record<TodoPriority, string> = {
  normal: '普通',
  important: '重要',
  urgent: '紧急'
};

const STATUS_LABELS: Record<string, string> = {
  open: '未完成',
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

/** One task row. Owns its own command state for status toggle, priority cycle,
 *  inline rename, and delete — so each row's buttons reflect their own
 *  pending/success/error state independently of the rest of the list. */
function TaskRow({
  task,
  view,
  now,
  depth,
  isSelected,
  projectName,
  overdue,
  canReorder,
  index,
  siblingIndex,
  siblingCount,
  onSelect,
  onMove
}: {
  task: Task;
  view: TaskView;
  now: number;
  depth: number;
  isSelected: boolean;
  projectName: string | undefined;
  overdue: boolean;
  canReorder: boolean;
  index: number;
  siblingIndex: number;
  siblingCount: number;
  onSelect: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const toggleStatus = useCommand((status: TaskStatus) => commands.tasks.setStatus(task.id, status));
  const cyclePriority = useCommand((priority: TodoPriority) => commands.tasks.update(task.id, { priority }));
  const rename = useCommand((input: TaskUpdateInput) => commands.tasks.update(task.id, input));
  const remove = useCommand(() => commands.tasks.delete(task.id));

  const startEdit = useCallback((current: string) => {
    setEditingId(task.id);
    setEditText(current);
  }, [task.id]);

  const commitEdit = useCallback(() => {
    if (editingId === null) {
      return;
    }
    const text = editText.trim();
    if (text) {
      void rename.run({ title: text }).then((result) => {
        if (result.ok) {
          setEditingId(null);
          setEditText('');
        }
      });
    } else {
      setEditingId(null);
      setEditText('');
    }
  }, [editingId, editText, rename]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const toggle = useCallback(() => {
    const next: TaskStatus = task.status === 'done' ? 'open' : 'done';
    void toggleStatus.run(next);
  }, [task.status, toggleStatus]);

  return (
    <li
      className={`task-row ${isSelected ? 'is-selected' : ''} ${task.status === 'done' ? 'is-done' : ''}`.trim()}
      style={{ ['--task-depth' as string]: depth }}
      onClick={() => onSelect(task.id)}
      draggable={canReorder}
      onDragStart={() => setDraggingId(task.id)}
      onDragOver={(event) => canReorder && event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setDraggingId(null);
      }}
      onDragEnd={() => setDraggingId(null)}
    >
      <CommandButton
        type="button"
        className="task-priority-dot"
        data-priority={task.priority}
        state={cyclePriority.state}
        errorReason={cyclePriority.error?.message}
        title={`优先级：${PRIORITY_LABELS[task.priority]}（点击切换）`}
        aria-label={`优先级：${PRIORITY_LABELS[task.priority]}`}
        onClick={(event) => {
          event.stopPropagation();
          void cyclePriority.run(nextTodoPriority(task.priority));
        }}
      >
        <span className="visually-hidden">{PRIORITY_LABELS[task.priority]}</span>
      </CommandButton>
      <CommandButton
        type="button"
        className="task-checkbox"
        state={toggleStatus.state}
        errorReason={toggleStatus.error?.message}
        title={task.status === 'done' ? '标记为未完成' : '标记为完成'}
        aria-label={task.status === 'done' ? '标记为未完成' : '标记为完成'}
        aria-pressed={task.status === 'done'}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        {task.status === 'done' ? <Check size={11} /> : null}
      </CommandButton>
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
              startEdit(task.title);
            }}
          >
            {task.title}
          </span>
        )}
        <div className="task-meta">
          {task.plannedAt !== null ? (
            <span className={`task-due ${overdue && task.status !== 'done' ? 'is-overdue' : ''}`}>
              ○ {isToday(task.plannedAt, now) ? formatDateTime(task.plannedAt) : `计划 ${formatDue(task.plannedAt)}`}
            </span>
          ) : null}
          {task.dueAt !== null ? (
            <span className={`task-due ${overdue && task.status !== 'done' ? 'is-overdue' : ''}`}>
              ◇ {isToday(task.dueAt, now) ? formatDateTime(task.dueAt) : `截止 ${formatDue(task.dueAt)}`}
            </span>
          ) : null}
          <span className="context-tag" title={`上下文：${contextLabel[task.context]}`}>
            {contextIcon(task.context)}
            <span>{contextLabel[task.context]}</span>
          </span>
          {projectName ? (
            <span className="project-chip" style={{ ['--chip-color' as string]: '#8aa0a6' }}>
              <span className="project-chip-dot" />
              <span>{projectName}</span>
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
        <button type="button" title="上移" aria-label={`上移「${task.title}」`} disabled={!canReorder || siblingIndex === 0} onClick={(event) => { event.stopPropagation(); onMove(index, -1); }}><ArrowUp size={11} /></button>
        <button type="button" title="下移" aria-label={`下移「${task.title}」`} disabled={!canReorder || siblingIndex === siblingCount - 1} onClick={(event) => { event.stopPropagation(); onMove(index, 1); }}><ArrowDown size={11} /></button>
      </span>
      <CommandButton
        type="button"
        className="task-remove"
        state={remove.state}
        errorReason={remove.error?.message}
        title="删除"
        aria-label={`删除「${task.title}」`}
        onClick={(event) => {
          event.stopPropagation();
          void remove.run();
        }}
      >
        <Trash2 size={13} />
      </CommandButton>
    </li>
  );
}

export function TaskList({
  tasks,
  view,
  projects,
  now,
  selectedTaskId,
  scopeProjectId,
  onSelect,
  onMove
}: {
  tasks: Task[];
  view: TaskView;
  projects: Project[];
  now: number;
  selectedTaskId: string | null;
  scopeProjectId?: string | null;
  onSelect: (id: string) => void;
  onMove?: (taskId: string, beforeTaskId: string | null) => void;
}): JSX.Element {
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

  const handleMove = useCallback((index: number, direction: -1 | 1) => {
    const task = orderedTasks[index];
    const siblings = orderedTasks.filter((entry) => entry.parentId === task?.parentId);
    const siblingIndex = siblings.findIndex((entry) => entry.id === task?.id);
    const neighbor = siblings[siblingIndex + direction];
    if (!task || !neighbor || !onMove) {
      return;
    }
    const beforeTaskId = direction < 0 ? neighbor.id : siblings[siblingIndex + 2]?.id ?? null;
    onMove(task.id, beforeTaskId);
  }, [orderedTasks, onMove]);

  if (tasks.length === 0) {
    return <p className="task-empty empty-state">这里还没有任务，添加一件吧。</p>;
  }

  return (
    <ul className="task-list">
      {orderedTasks.map((task, index) => {
        const siblings = orderedTasks.filter((entry) => entry.parentId === task.parentId);
        const siblingIndex = siblings.findIndex((entry) => entry.id === task.id);
        const project = task.projectId ? projectById.get(task.projectId) : undefined;
        const overdue =
          (task.dueAt !== null && task.dueAt < new Date(now).setHours(0, 0, 0, 0)) ||
          (task.plannedAt !== null && task.plannedAt < new Date(now).setHours(0, 0, 0, 0));
        return (
          <TaskRow
            key={task.id}
            task={task}
            view={view}
            now={now}
            depth={depthById.get(task.id) ?? 0}
            isSelected={selectedTaskId === task.id}
            projectName={project?.name}
            overdue={overdue}
            canReorder={Boolean(onMove)}
            index={index}
            siblingIndex={siblingIndex}
            siblingCount={siblings.length}
            onSelect={onSelect}
            onMove={handleMove}
          />
        );
      })}
    </ul>
  );
}
