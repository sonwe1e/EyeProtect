import { useEffect, useState } from 'react';

export const useActiveTaskId = (): string | null => {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getActiveTaskId().then((next) => mounted && setId(next));
    const off = window.eyeProtect.onActiveTaskChanged(setId);
    return () => {
      mounted = false;
      off();
    };
  }, []);
  return id;
};
