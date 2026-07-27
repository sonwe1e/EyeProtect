import { useEffect, useState } from 'react';

/**
 * Periodic re-render clock for time-derived text. Hidden windows pause their
 * timer so background renderers do not wake up for invisible labels.
 */
export const useClock = (intervalMs: number): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: number | null = null;

    const start = (): void => {
      if (timer !== null || document.hidden) {
        return;
      }
      timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = (): void => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        stop();
        return;
      }
      setNow(Date.now());
      start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return now;
};
