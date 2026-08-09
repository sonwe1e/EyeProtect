import { useEffect, useState } from 'react';
import type { UndoState } from '../../../shared/types';

export const useUndo = (): UndoState | null => {
  const [state, setState] = useState<UndoState | null>(null);
  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getUndoState().then((next) => mounted && setState(next));
    const off = window.eyeProtect.onUndoChanged(setState);
    return () => { mounted = false; off(); };
  }, []);
  useEffect(() => {
    if (!state) return;
    const timer = window.setTimeout(() => setState(null), Math.max(0, state.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state]);
  return state;
};
