import { memo, useCallback, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, Check, Flag, Footprints, Trash2 } from 'lucide-react';
import {
  TASK_TITLE_MAX,
  nextTodoPriority,
  type Project,
  type Task,
  type TaskStatus,
  type TaskUpdateInput,
  type TaskView,
  type TimeBlock,
  type TodoPriority
} from '../../../../shared/types';
import { CommandButton } from '../../components/CommandButton';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';
import { resolveSiblingDrop } from './taskReorder';
import { getTaskRowMetadata } from './taskRowMetadata';

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

const overdueSince = (startOfToday: number, task: Task): boolean =>
  (task.dueAt !== null && task.dueAt < startOfToday) ||
  (task.plannedAt !== null && task.plannedAt < startOfToday);

const isToday = (timestamp: number, now: number): boolean => {
  const a = new Date(timestamp);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

/** One task row. Owns its own command state for status toggle, priority cycle,
 *  inline rename, and delete — so each row's buttons reflect their own
 *  pending/success/error state independently of the rest of the list. */
const TaskRow = memo(function TaskRow({
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
  isDragging,
  timeBlocks,
  scopedToProject,
  onSelect,
  onMove,
  onDragStartRow,
  onDropOnRow,
  onDragEndRow
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
  isDragging: boolean;
  timeBlocks: TimeBlock[];
  scopedToProject: boolean;
  onSelect: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onDragStartRow: (id: string) => void;
  onDropOnRow: (targetId: string) => void;
  onDragEndRow: () => void;
}): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isDropTarget, setIsDropTarget] = useState(false);

  const toggleStatus = useCommand((status: TaskStatus) => commands.tasks.setStatus(task.id, status));
  const cyclePriority = useCommand((priority: TodoPriority) => commands.tasks.update(task.id, { priority }));
  const rename = useCommand((input: TaskUpdateInput) => commands.tasks.update(task.id, input));
  const remove = useCommand(() => commands.tasks.delete(task.id));
  const metadata = getTaskRowMetadata(task, view, now, projectName, timeBlocks, scopedToProject);

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
      className={`task-row ${isSelected ? 'is-selected' : ''} ${task.status === 'done' ? 'is-done' : ''} ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drag-over' : ''}`.trim()}
      style={{ ['--task-depth' as string]: depth }}
      onClick={() => onSelect(task.id)}
      draggable={canReorder}
      onDragStart={(event) => {
        if (!canReorder) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        onDragStartRow(task.id);
      }}
      onDragOver={(event) => {
        if (canReorder) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setIsDropTarget(true);
        }
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDropTarget(false);
        onDropOnRow(task.id);
      }}
      onDragEnd={() => {
        setIsDropTarget(false);
        onDragEndRow();
      }}
    >
      <CommandButton
        type="button"
        className="task-priority-dot"
        data-priority={task.priority}
        state={cyclePriority.state}
        successFeedback="none"
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
        successFeedback="none"
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
          <button
            type="button"
            className="task-title"
            title={`${task.title}（双击编辑）`}
            aria-label={`打开任务「${task.title}」`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(task.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              startEdit(task.title);
            }}
          >
            {task.title}
          </button>
        )}
        <div className="task-meta">
          {metadata.map((item) => {
            if (item.kind === 'scheduled' && item.timestamp !== undefined) {
              return <span key={item.kind} className="task-due"><CalendarClock size={11} aria-hidden="true" />{formatDateTime(item.timestamp)}</span>;
            }
            if (item.kind === 'due' && item.timestamp !== undefined) {
              return (
                <span key={item.kind} className={`task-due ${overdue && task.status !== 'done' ? 'is-overdue' : ''}`}>
                  <Flag size={11} aria-hidden="true" />{isToday(item.timestamp, now) ? formatDateTime(item.timestamp) : `截止 ${formatDue(item.timestamp)}`}
                </span>
              );
            }
            if (item.kind === 'context') {
              return <span key={item.kind} className="context-tag"><Footprints size={11} /><span>{item.value}</span></span>;
            }
            if (item.kind === 'project') {
              return <span key={item.kind} className="project-chip"><span className="project-chip-dot" /><span>{item.value}</span></span>;
            }
            return <span key={`${item.kind}-${item.value}`} className="task-tag">#{item.value}</span>;
          })}
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
});

export function TaskList({
  tasks,
  view,
  projects,
  now,
  selectedTaskId,
  scopeProjectId,
  timeBlocks = [],
  onSelect,
  onMove
}: {
  tasks: Task[];
  view: TaskView;
  projects: Project[];
  now: number;
  selectedTaskId: string | null;
  scopeProjectId?: string | null;
  timeBlocks?: TimeBlock[];
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

  // Drag state lives at list level so the drop handler knows which row was
  // grabbed — a per-row `draggingId` (the old implementation) is invisible
  // to every other row.
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const { orderedTasks, depthById, siblingsByParent } = useMemo(() => {
    const ids = new Set(tasks.map((task) => task.id));
    const children = new Map<string, Task[]>();
    const roots: Task[] = [];
    const siblingsByParent = new Map<string, Task[]>();
    for (const task of tasks) {
      const parentKey = task.parentId ?? '';
      siblingsByParent.set(parentKey, [...(siblingsByParent.get(parentKey) ?? []), task]);
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
    return { orderedTasks: ordered, depthById: depths, siblingsByParent };
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

  /**
   * HTML5 drag & drop reorder (USERPLAN 1.2 PR0: the old `onDrop` only
   * cleared local state and never called `onMove`, so dragging looked
   * functional but persisted nothing). Dropping on a row inserts the dragged
   * task ABOVE the target within the same sibling group; dropping on the
   * list background moves it to the end.
   */
  const handleDropOnRow = useCallback((targetId: string, sourceId: string | null) => {
    if (!sourceId || !onMove) return;
    const beforeTaskId = resolveSiblingDrop(orderedTasks, sourceId, targetId);
    if (beforeTaskId === undefined) return;
    onMove(sourceId, beforeTaskId);
  }, [orderedTasks, onMove]);

  const handleDragEnd = useCallback((): void => {
    setDraggingId(null);
  }, []);

  // Stable per-render callback for row drops: resolves the dragged id from
  // the list-level state. Recreated only when the drag target changes.
  const handleRowDrop = useCallback((targetId: string): void => {
    setDraggingId(null);
    handleDropOnRow(targetId, draggingId);
  }, [handleDropOnRow, draggingId]);

  // Computed once per render instead of per row (O(n) vs O(n²)).
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);

  if (tasks.length === 0) {
    return <p className="task-empty empty-state">这里还没有任务，添加一件吧。</p>;
  }

  return (
    <ul
      className={`task-list task-list--${view}`}
      onDragOver={(event) => { if (onMove) event.preventDefault(); }}
      onDrop={(event) => {
        event.preventDefault();
        const sourceId = draggingId;
        setDraggingId(null);
        if (!sourceId || !onMove) return;
        // Drop on the list background: move to the end of its sibling group.
        onMove(sourceId, null);
      }}
    >
      {orderedTasks.map((task, index) => {
        const siblings = siblingsByParent.get(task.parentId ?? '') ?? [];
        const siblingIndex = siblings.findIndex((entry) => entry.id === task.id);
        const project = task.projectId ? projectById.get(task.projectId) : undefined;
        const overdue = overdueSince(startOfToday, task);
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
            isDragging={draggingId === task.id}
            timeBlocks={timeBlocks}
            scopedToProject={Boolean(scopeProjectId)}
            onSelect={onSelect}
            onMove={handleMove}
            onDragStartRow={setDraggingId}
            onDropOnRow={handleRowDrop}
            onDragEndRow={handleDragEnd}
          />
        );
      })}
    </ul>
  );
}
