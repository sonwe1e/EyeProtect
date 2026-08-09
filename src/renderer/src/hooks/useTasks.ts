import { useEffect, useState } from 'react';
import type { Task } from '../../../shared/types';

export const useTasks = (): Task[] => {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getTasks().then((next) => {
      if (mounted && next) {
        setTasks(next);
      }
    });
    const offTasks = window.eyeProtect.onTasksChanged(setTasks);
    return () => {
      mounted = false;
      offTasks();
    };
  }, []);

  return tasks;
};
