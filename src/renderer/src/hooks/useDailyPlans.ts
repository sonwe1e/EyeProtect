import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { DailyTaskPlan } from '../../../shared/types';

/**
 * Daily plan subscription for one local date (USERPLAN 1.2 PR3).
 *
 * Plans mutate through the command layer; every mutation result carries the
 * fresh list of the affected date, so components apply it via `setPlans`
 * without a second round-trip. Bulk task events (undo, backup import,
 * legacy migration) trigger a refetch because they can replace the whole
 * planning domain at once.
 */
export const useDailyPlans = (
  localDate: string
): {
  plans: DailyTaskPlan[];
  setPlans: Dispatch<SetStateAction<DailyTaskPlan[]>>;
  refresh: () => void;
} => {
  const [plans, setPlans] = useState<DailyTaskPlan[]>([]);

  const refresh = useCallback(() => {
    let cancelled = false;
    void window.eyeProtect.getDailyPlans(localDate).then((next) => {
      if (!cancelled) setPlans(next);
    });
    return () => {
      cancelled = true;
    };
  }, [localDate]);

  useEffect(() => {
    const cancel = refresh();
    const offBulk = window.eyeProtect.onTasksChanged(() => refresh());
    return () => {
      cancel();
      offBulk();
    };
  }, [refresh]);

  return { plans, setPlans, refresh };
};
