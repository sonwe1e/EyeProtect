import { useEffect, useState } from 'react';
import type { FocusStatus } from '../../../shared/types';

const EMPTY: FocusStatus = {
  session: null,
  todayTaskMs: 0,
  totalTaskMs: 0,
  plannedMinutes: null,
  block: null
};

/**
 * Focus session subscription (USERPLAN 1.2 PR6). Hydrates via `focus:get`,
 * then follows `focus:session-changed` pushes. Every transition (start,
 * pause, complete, break pause/resume, segment accumulation) emits, so the
 * Focus surface always shows the live state machine.
 */
export const useFocusStatus = (): FocusStatus => {
  const [status, setStatus] = useState<FocusStatus>(EMPTY);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getFocusStatus().then((next) => {
      if (mounted && next) setStatus(next);
    });
    const off = window.eyeProtect.onFocusStatusChanged((next) => setStatus(next));
    return () => {
      mounted = false;
      off();
    };
  }, []);

  return status;
};
