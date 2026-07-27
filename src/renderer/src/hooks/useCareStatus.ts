import { useEffect, useState } from 'react';
import type { CareStatus } from '../../../shared/types';

const DEFAULT_CARE: CareStatus = {
  score: 50,
  completedToday: 0,
  snoozedToday: 0,
  skippedToday: 0,
  naturalBreaksToday: 0,
  mood: 'calm',
  accessory: 'none',
  message: '今天从轻松开始'
};

export const useCareStatus = (): CareStatus => {
  const [care, setCare] = useState<CareStatus>(DEFAULT_CARE);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getCareStatus().then((next) => {
      if (mounted) {
        setCare(next);
      }
    });
    const off = window.eyeProtect.onCareStatusChanged(setCare);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  return care;
};
