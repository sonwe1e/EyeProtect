import { useEffect, useState } from 'react';
import type { Alarm } from '../../../shared/types';

export const useAlarms = (): Alarm[] => {
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getAlarms().then((next) => {
      if (mounted) {
        setAlarms(next);
      }
    });
    const offAlarms = window.eyeProtect.onAlarmsChanged(setAlarms);
    return () => {
      mounted = false;
      offAlarms();
    };
  }, []);

  return alarms;
};
