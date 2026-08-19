import { useEffect, useState } from 'react';
import type { StandaloneReminder } from '../../../shared/types';

export const useStandaloneReminders = (): StandaloneReminder[] => {
  const [reminders, setReminders] = useState<StandaloneReminder[]>([]);
  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getStandaloneReminders().then((next) => mounted && setReminders(next));
    const off = window.eyeProtect.onStandaloneRemindersChanged(setReminders);
    return () => {
      mounted = false;
      off();
    };
  }, []);
  return reminders;
};
