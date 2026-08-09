import { useEffect, useState } from 'react';
import type { TaskWorkSummary } from '../../../shared/types';

const EMPTY: TaskWorkSummary = {
  taskId: null,
  taskActiveMs: 0,
  currentSessionMs: 0,
  continuousActiveMs: 0,
  timeboxNotified: false
};

export const useTaskWork = (): TaskWorkSummary => {
  const [summary, setSummary] = useState(EMPTY);
  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getTaskWorkSummary().then((next) => mounted && setSummary(next));
    const off = window.eyeProtect.onTaskWorkChanged(setSummary);
    return () => { mounted = false; off(); };
  }, []);
  return summary;
};
