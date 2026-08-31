import { sameLocalDate } from '../../../../shared/calendar';
import type { Task, TaskView, TimeBlock } from '../../../../shared/types';

export type TaskRowMetadataKind = 'scheduled' | 'due' | 'context' | 'project' | 'tag';

export interface TaskRowMetadataItem {
  kind: TaskRowMetadataKind;
  value: string;
  timestamp?: number;
}

/**
 * Selects the small amount of context that belongs in a row for the current
 * view. A TimeBlock is the only source of an exact scheduled time; the legacy
 * task.plannedAt field must never be presented as a calendar block.
 */
export function getTaskRowMetadata(
  task: Task,
  view: TaskView,
  now: number,
  projectName: string | undefined,
  timeBlocks: TimeBlock[],
  scopedToProject: boolean
): TaskRowMetadataItem[] {
  const items: TaskRowMetadataItem[] = [];

  if (view === 'today') {
    const scheduled = timeBlocks
      .filter((block) => block.taskId === task.id && sameLocalDate(block.startAt, now))
      .sort((left, right) => left.startAt - right.startAt)[0];
    if (scheduled) {
      items.push({ kind: 'scheduled', value: 'scheduled', timestamp: scheduled.startAt });
    } else if (task.dueAt !== null) {
      items.push({ kind: 'due', value: 'due', timestamp: task.dueAt });
    }
  } else if (task.dueAt !== null) {
    items.push({ kind: 'due', value: 'due', timestamp: task.dueAt });
  }

  if (view === 'today' && !scopedToProject && projectName) {
    items.push({ kind: 'project', value: projectName });
  }

  if (task.context === 'away' && view !== 'away') {
    items.push({ kind: 'context', value: '外出' });
  } else if (task.tags[0]) {
    items.push({ kind: 'tag', value: task.tags[0] });
  }

  return items.slice(0, 3);
}
