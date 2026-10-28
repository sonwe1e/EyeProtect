import { useEffect, useState } from 'react';

/** Artwork frames only; reminder and pomodoro timing stays in the main process. */
export function useAnimalFrame(action: string, identity: string, motion = true, animationKey?: string | number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = (): void => {
      clearInterval(timer);
      setFrame(0);
      if (!motion || document.hidden || reduced.matches) return;
      let step = 0;
      timer = setInterval(() => {
        step += 1;
        if (action === 'idle' || action === 'breathe') setFrame(step % 100);
        else {
          setFrame(step < 12 ? step : 0);
          if (step >= 12) clearInterval(timer);
        }
      }, action === 'idle' || action === 'breathe' ? 160
        : action === 'celebrate' ? 40
          : action === 'react' ? 130
            // 12 frames × 216ms ≈ 2.6s, the same window the main process uses
            // for the sip (HYDRATION_SIP_MS), so the cup empties exactly as the
            // strip appears instead of drifting a frame or two behind it.
            : action === 'sip' ? 216
              : 240);
    };
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    sync();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
    };
  }, [action, identity, motion, animationKey]);
  return motion ? frame : 0;
}
