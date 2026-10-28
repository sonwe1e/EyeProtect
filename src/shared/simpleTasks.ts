import { localDateKey } from './calendar';
import type { Task, Project } from './types';

export const isSimpleList = (project: Project): boolean => project.status === 'active' || project.status === 'onHold';

/**
 * One rule for "this task lives in a live list": an inbox task (no list) always
 * qualifies, a task in a completed/archived list never does. `isCurrentTask`
 * and `openQueueTasks` both read it so the two views can never disagree about
 * which tasks the user may still move.
 */
const isQueueList = (projectId: string | null, projects: Project[]): boolean =>
  !projectId || projects.some((project) => project.id === projectId && isSimpleList(project));

export const isCurrentTask = (task: Task, projects: Project[]): boolean =>
  !task.parentId && task.status !== 'archived' && isQueueList(task.projectId, projects);

/**
 * Completion-record restore: keep the original list only when it is still a
 * live simple list. Inactive lists rehome the task to the default list
 * instead of resurrecting the whole project into the todo filter.
 */
export const resolveRestoredTaskProjectId = (
  taskProjectId: string | null | undefined,
  projectStatus: string | undefined
): string | null => {
  if (!taskProjectId) return null;
  const listIsLive = projectStatus === 'active' || projectStatus === 'onHold';
  return listIsLive ? taskProjectId : null;
};

export const taskSteps = (rootId: string, tasks: Task[]): Task[] => {
  const seen = new Set([rootId]);
  const result: Task[] = [];
  const visit = (id: string): void => {
    for (const child of tasks.filter((task) => task.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return result;
};

/**
 * The tasks that belong to today's queue: root tasks of a writable list (an
 * inbox task with no list counts as writable). Completed tasks stay in the
 * queue because the queue sinks them to its tail instead of hiding them —
 * hiding them would make undo look like a resurrection (AC-06).
 */
export const openQueueTasks = (tasks: Task[], projects: Project[]): Task[] =>
  tasks.filter((task) => isCurrentTask(task, projects));

/**
 * Manual order, with two deterministic fallbacks. Legacy rows all carry
 * `sortOrder === 0`, so without `createdAt`/`id` a re-render could shuffle
 * them arbitrarily. The comparison is also the "existing order" the main
 * process uses when it appends unlisted tasks to the queue tail.
 */
const byQueueOrder = (left: Task, right: Task): number =>
  left.sortOrder - right.sortOrder || left.createdAt - right.createdAt || left.id.localeCompare(right.id);

/**
 * Position is the priority: open tasks first, completed ones sunk to the tail.
 * Both groups keep their manual order. The input array is never reordered in
 * place — callers pass state they do not own.
 */
export const orderSimpleQueue = (tasks: Task[]): Task[] => [
  ...tasks.filter((task) => task.status === 'open').sort(byQueueOrder),
  ...tasks.filter((task) => task.status !== 'open').sort(byQueueOrder)
];

/**
 * What today's page actually renders: the queue above, narrowed to tasks that
 * are still open plus the ones completed TODAY. Without the second half the
 * tail would grow with every task ever completed, and "today" would stop
 * meaning today.
 */
export const queueTasksForToday = (tasks: Task[], projects: Project[], todayKey: string): Task[] =>
  orderSimpleQueue(
    openQueueTasks(tasks, projects).filter(
      (task) => task.status === 'open' || (task.completedAt !== null && localDateKey(task.completedAt) === todayKey)
    )
  );

/**
 * Return a new id list with `movingId` placed before or after `targetId`.
 * Unknown ids — and dropping a row onto itself — return the list unchanged, so
 * a stale drag can never invent an order out of ids the queue does not have.
 */
export const moveQueueItem = (
  ids: string[],
  movingId: string,
  targetId: string,
  position: 'before' | 'after'
): string[] => {
  if (movingId === targetId || !ids.includes(movingId) || !ids.includes(targetId)) return [...ids];
  const rest = ids.filter((id) => id !== movingId);
  const anchor = rest.indexOf(targetId);
  rest.splice(position === 'after' ? anchor + 1 : anchor, 0, movingId);
  return rest;
};
