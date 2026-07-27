import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/types';

export const useSettings = (): {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
} => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getSettings().then((next) => {
      if (mounted) {
        setSettings(next);
      }
    });
    const offSettings = window.eyeProtect.onSettingsChanged(setSettings);
    return () => {
      mounted = false;
      offSettings();
    };
  }, []);

  return { settings, setSettings };
};
