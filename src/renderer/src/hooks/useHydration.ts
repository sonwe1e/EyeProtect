import { useEffect, useState } from 'react';
import type { HydrationStatus } from '../../../shared/types';

/**
 * Hydration state, shared by the pet and the bubble.
 *
 * Both windows only RENDER what the main process decided: the count, the day and
 * the prompt lifetime all come from `hydration:changed`, and the renderer never
 * counts cups or times the strip itself. `null` means "not read yet", which is
 * different from "zero cups" — the cup chip must not flash 0/8 on first paint.
 */
export const useHydration = (): HydrationStatus | null => {
  const [status, setStatus] = useState<HydrationStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getHydration().then((next) => {
      if (mounted && next) setStatus(next);
    });
    const off = window.eyeProtect.onHydrationChanged((next) => {
      if (mounted) setStatus(next);
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);

  return status;
};
