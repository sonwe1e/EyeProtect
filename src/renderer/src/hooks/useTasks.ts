import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../../../shared/types';

/**
 * Task subscription (USERPLAN 1.2 PR2: incremental renderer state).
 *
 * `task:list` hydrates once; afterwards single-entity mutations arrive as
 * `task:upserted` / `task:removed` deltas applied to a normalized
 * Map<TaskId, Task>. Editing one task no longer SELECTs and broadcasts the
 * whole table. The full-list channel stays as a bulk resync for undo /
 * backup import / legacy migration (`tasks-replaced`).
 *
 * Ordering is derived from the domain fields (sortOrder, createdAt) instead
 * of array position, so delta-only updates keep list order correct.
 */
export const useTasks = (): Task[] => {
  const [taskMap, setTaskMap] = useState<Map<string, Task>>(() => new Map());

  useEffect(() => {
    let mounted = true;
    const hydrate = (list: Task[]): void => {
      setTaskMap(new Map(list.map((task) => [task.id, task])));
    };
    void window.eyeProtect.getTasks().then((next) => {
      if (mounted && next) {
        hydrate(next);
      }
    });
    const offUpserted = window.eyeProtect.onTaskUpserted((task) => {
      setTaskMap((previous) => {
        const next = new Map(previous);
        next.set(task.id, task);
        return next;
      });
    });
    const offRemoved = window.eyeProtect.onTaskRemoved((taskId) => {
      setTaskMap((previous) => {
        if (!previous.has(taskId)) return previous;
        const next = new Map(previous);
        next.delete(taskId);
        return next;
      });
    });
    const offBulk = window.eyeProtect.onTasksChanged((list) => {
      hydrate(list);
    });
    return () => {
      mounted = false;
      offUpserted();
      offRemoved();
      offBulk();
    };
  }, []);

  return useMemo(
    () =>
      [...taskMap.values()].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt
      ),
    [taskMap]
  );
};
