import { useEffect, useState } from 'react';

export const useActiveTaskId = (): string | null => {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = (): void => {
      void window.eyeProtect.getActiveTaskId().then((next) => mounted && setId(next));
    };
    refresh();
    const off = window.eyeProtect.onActiveTaskChanged(setId);
    // FocusSessionService owns start/pause/complete and updates the active task
    // in the store directly. Those transitions emit focus status, so refresh
    // the active id here to keep the Workbench surface synchronized without
    // changing the domain or IPC contracts.
    const offFocus = window.eyeProtect.onFocusStatusChanged(refresh);
    return () => {
      mounted = false;
      off();
      offFocus();
    };
  }, []);
  return id;
};
