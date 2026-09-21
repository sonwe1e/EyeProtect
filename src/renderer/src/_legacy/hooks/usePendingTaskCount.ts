import { useEffect, useState } from 'react';

/**
 * Lightweight pending-task count for the always-resident pet window (perf
 * pass). The pet only renders the badge number, so it subscribes to a count
 * channel instead of the full task delta stream — a task edit elsewhere must
 * not make the 160px pet window rebuild a task Map and re-sort.
 */
export const usePendingTaskCount = (): number => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getPendingTaskCount().then((next) => {
      if (mounted && typeof next === 'number') {
        setCount(next);
      }
    });
    return window.eyeProtect.onPendingTaskCountChanged((next) => {
      if (typeof next === 'number') {
        setCount(next);
      }
    });
  }, []);

  return count;
};
