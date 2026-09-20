import { useEffect, useState } from 'react';
import type { PomodoroState } from '../../../shared/types';
import { useClock } from './useClock';

export const usePomodoro = (): PomodoroState => {
  const [snapshot, setSnapshot] = useState<{ state: PomodoroState; receivedAt: number }>({ state: { phase: 'idle', taskId: null, remainingMs: 0, running: false, revision: 0 }, receivedAt: performance.now() });
  useClock(1000);
  useEffect(() => {
    let live = true;
    const receive = (state: PomodoroState): void => { if (live) setSnapshot({ state, receivedAt: performance.now() }); };
    void window.eyeProtect.getPomodoro().then(receive);
    const off = window.eyeProtect.onPomodoroChanged(receive);
    return () => { live = false; off(); };
  }, []);
  return { ...snapshot.state, remainingMs: snapshot.state.running ? Math.max(0, snapshot.state.remainingMs - (performance.now() - snapshot.receivedAt)) : snapshot.state.remainingMs };
};
