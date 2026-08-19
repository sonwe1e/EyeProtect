import { useCallback, useEffect, useState } from 'react';
import type { DailyReviewSummary } from '../../../shared/types';

/**
 * Daily review snapshot subscription (USERPLAN 1.2 PR7).
 *
 * Review is mainly read-only and only updated when the current date’s relevant
 * domains mutate (plans, tasks, focus sessions, reminder history). Components
 * can call `refresh` after local date changes or navigation.
 */
export const useDailyReview = (localDate: string): {
  summary: DailyReviewSummary | null;
  refresh: () => void;
} => {
  const [summary, setSummary] = useState<DailyReviewSummary | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    void window.eyeProtect.getDailyReview(localDate).then((next) => {
      if (!cancelled) {
        setSummary(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [localDate]);

  useEffect(() => {
    const cancel = refresh();
    const offTasks = window.eyeProtect.onTasksChanged(() => refresh());
    const offPlans = window.eyeProtect.onDailyPlansChanged(() => refresh());
    const offFocus = window.eyeProtect.onFocusStatusChanged(() => refresh());
    const offHistory = window.eyeProtect.onWeeklyReportChanged(() => refresh());
    return () => {
      cancel();
      offTasks();
      offPlans();
      offFocus();
      offHistory();
    };
  }, [refresh]);

  return { summary, refresh };
};

