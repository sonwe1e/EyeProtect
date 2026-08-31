import type { TaskInput, TaskUpdateInput } from '../shared/types';

/**
 * IPC transport sanitizers for task create/update payloads (mirrors
 * ipcProjectInput.ts). Renderers are trusted code, but IPC payloads are still
 * an external input: every field is type-checked and whitelisted here before
 * it reaches TaskService/TaskStore.
 */
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asFiniteOrNull = (value: unknown): number | null | undefined =>
  value === null || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;

export const asTaskInput = (value: unknown): TaskInput => {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<TaskInput>;
  return {
    title: asString(candidate.title),
    notes:
      typeof candidate.notes === 'string' || candidate.notes === null
        ? candidate.notes
        : undefined,
    priority:
      candidate.priority === 'important' || candidate.priority === 'urgent' || candidate.priority === 'normal'
        ? candidate.priority
        : undefined,
    projectId:
      typeof candidate.projectId === 'string' || candidate.projectId === null
        ? candidate.projectId
        : undefined,
    parentId:
      typeof candidate.parentId === 'string' || candidate.parentId === null
        ? candidate.parentId
        : undefined,
    tags: Array.isArray(candidate.tags) ? candidate.tags.map((tag) => asString(tag)) : undefined,
    plannedAt: asFiniteOrNull(candidate.plannedAt),
    dueAt: asFiniteOrNull(candidate.dueAt),
    reminderAt: asFiniteOrNull(candidate.reminderAt),
    recurrence:
      candidate.recurrence === null || (candidate.recurrence && typeof candidate.recurrence === 'object')
        ? (candidate.recurrence as TaskInput['recurrence'])
        : undefined,
    context:
      candidate.context === 'desk' || candidate.context === 'away' || candidate.context === 'any'
        ? candidate.context
        : undefined,
    remindOnBreak:
      typeof candidate.remindOnBreak === 'boolean' ? candidate.remindOnBreak : undefined,
    estimateMinutes: asFiniteOrNull(candidate.estimateMinutes)
  };
};

export const asTaskUpdateInput = (value: unknown): TaskUpdateInput => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const candidate = value as Partial<TaskUpdateInput>;
  const input = asTaskInput(value) as TaskUpdateInput;
  if (typeof candidate.title !== 'string') {
    delete input.title;
  }
  for (const key of Object.keys(input) as Array<keyof TaskUpdateInput>) {
    if (input[key] === undefined) {
      delete input[key];
    }
  }
  if (
    candidate.status === 'open' || candidate.status === 'done' || candidate.status === 'archived'
  ) {
    input.status = candidate.status;
  }
  if (
    typeof candidate.sortOrder === 'number' &&
    Number.isInteger(candidate.sortOrder) &&
    candidate.sortOrder >= 0
  ) {
    input.sortOrder = candidate.sortOrder;
  }
  // Optimistic-concurrency guard (USERPLAN PR2): the draft's baseRevision must
  // reach the store, or the stale-write rejection can never fire on the IPC
  // path and concurrent edits silently overwrite each other.
  if (
    typeof candidate.baseRevision === 'number' &&
    Number.isInteger(candidate.baseRevision) &&
    candidate.baseRevision >= 1
  ) {
    input.baseRevision = candidate.baseRevision;
  }
  return input;
};
