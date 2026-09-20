import { useEffect, useMemo, useState } from 'react';
import type { TaskWorkSummary } from '../../../shared/types';

const EMPTY: TaskWorkSummary = {
  taskId: null,
  tracking: false,
  taskActiveMs: 0,
  currentSessionMs: 0,
  continuousActiveMs: 0,
  timeboxNotified: false
};

interface TimedSummary {
  summary: TaskWorkSummary;
  receivedAt: number;
}

export const interpolateTaskWork = (
  { summary, receivedAt }: TimedSummary,
  now: number
): TaskWorkSummary => {
  if (!summary.tracking || !summary.taskId) return summary;
  const elapsed = Math.max(0, now - receivedAt);
  return {
    ...summary,
    taskActiveMs: summary.taskActiveMs + elapsed,
    currentSessionMs: summary.currentSessionMs + elapsed,
    continuousActiveMs: summary.continuousActiveMs + elapsed
  };
};

export const useTaskWork = (): TaskWorkSummary => {
  const [timed, setTimed] = useState<TimedSummary>({ summary: EMPTY, receivedAt: performance.now() });
  const [clock, setClock] = useState(() => performance.now());
  useEffect(() => {
    let mounted = true;
    const receive = (summary: TaskWorkSummary): void => {
      const receivedAt = performance.now();
      setTimed({ summary, receivedAt });
      setClock(receivedAt);
    };
    void window.eyeProtect.getTaskWorkSummary().then((next) => mounted && receive(next));
    const off = window.eyeProtect.onTaskWorkChanged(receive);
    return () => { mounted = false; off(); };
  }, []);
  useEffect(() => {
    if (!timed.summary.tracking) return;
    const timer = window.setInterval(() => setClock(performance.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [timed.summary.tracking]);
  return useMemo(() => interpolateTaskWork(timed, clock), [timed, clock]);
};
