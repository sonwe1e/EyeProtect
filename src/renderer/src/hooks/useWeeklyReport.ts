import { useEffect, useState } from 'react';
import type { WeeklyReport } from '../../../shared/types';

export const useWeeklyReport = (): WeeklyReport | null => {
  const [report, setReport] = useState<WeeklyReport | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getWeeklyReport().then((next) => {
      if (mounted) {
        setReport(next);
      }
    });
    const off = window.eyeProtect.onWeeklyReportChanged(setReport);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  return report;
};
