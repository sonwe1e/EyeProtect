import { useEffect, useState } from 'react';

/** Artwork frames only; reminder and pomodoro timing stays in the main process. */
export function useAnimalFrame(action: string, identity: string, motion = true): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = (): void => {
      clearInterval(timer);
      setFrame(0);
      if (!motion || action === 'idle' || document.hidden || reduced.matches) return;
      let step = 0;
      timer = setInterval(() => {
        step += 1;
        setFrame(step < 12 ? step : 0);
        if (step >= 12) clearInterval(timer);
      }, action === 'react' ? 130 : 240);
    };
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    sync();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
    };
  }, [action, identity, motion]);
  return motion ? frame : 0;
}
