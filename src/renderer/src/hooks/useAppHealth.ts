import { useEffect, useState } from 'react';
import type { AppHealth } from '../../../shared/types';

/**
 * Subscribes to the global {@link AppHealth} (USERPLAN §二十八). The main
 * process pushes `app:health:changed` whenever database, scheduler, or
 * notification availability changes, so the UI can explain *why* an action is
 * unavailable instead of pretending everything is fine.
 */
export const useAppHealth = (): AppHealth | null => {
  // Start from a distinct "loading" state instead of lying "healthy": on a
  // DB-recovery launch there is a one-round-trip window before the first real
  // value arrives, and we must not hide the banner during that window.
  const [health, setHealth] = useState<AppHealth | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getAppHealth().then((next) => {
      if (mounted && next) {
        setHealth(next);
      }
    });
    return window.eyeProtect.onAppHealthChanged((next) => {
      if (mounted) {
        setHealth(next);
      }
    });
  }, []);

  return health;
};
