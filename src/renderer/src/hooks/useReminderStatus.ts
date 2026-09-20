import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type ReminderStatus } from '../../../shared/types';

const createDefaultStatus = (): ReminderStatus => ({
  nextEyeAt: Date.now() + DEFAULT_SETTINGS.eyeIntervalMinutes * 60_000,
  nextWalkAt: Date.now() + DEFAULT_SETTINGS.walkIntervalMinutes * 60_000,
  pausedUntil: null,
  activeReminder: null,
  preAlert: null,
  contextDeferral: null
});

export const useReminderStatus = (): ReminderStatus => {
  const [status, setStatus] = useState<ReminderStatus>(createDefaultStatus);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getReminderStatus().then((next) => {
      if (mounted && next) {
        setStatus(next);
      }
    });
    const offReminder = window.eyeProtect.onReminderChanged(setStatus);
    return () => {
      mounted = false;
      offReminder();
    };
  }, []);

  return status;
};
