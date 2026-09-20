import { useCallback, useEffect, useState } from 'react';
import type { TaskCheckpoint } from '../../../shared/types';

export const useTaskCheckpoints = (taskId: string): {
  checkpoints: TaskCheckpoint[];
  refresh: () => void;
} => {
  const [checkpoints, setCheckpoints] = useState<TaskCheckpoint[]>([]);
  const refresh = useCallback(() => {
    void window.eyeProtect.getTaskCheckpoints(taskId).then(setCheckpoints);
  }, [taskId]);
  useEffect(() => {
    refresh();
    return window.eyeProtect.onTaskCheckpointsChanged((payload) => {
      if (payload.taskId === null || payload.taskId === taskId) refresh();
    });
  }, [refresh, taskId]);
  return { checkpoints, refresh };
};
