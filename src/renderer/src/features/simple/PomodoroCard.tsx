import { useEffect, useRef, useState } from 'react';
import { SIMPLE_SETTING_LIMITS, type PomodoroState } from '../../../../shared/types';
import { useSettings } from '../../hooks/useSettings';
import { useCommand } from '../../hooks/useCommand';
import { run } from '../../lib/commands';

export function PomodoroCard({ state, taskTitle }: { state: PomodoroState; taskTitle: string | null }): JSX.Element {
  const { settings } = useSettings();
  const [minutes, setMinutes] = useState(settings.pomodoroMinutes);
  const edited = useRef(false);
  useEffect(() => { if (!edited.current) setMinutes(settings.pomodoroMinutes); }, [settings.pomodoroMinutes]);
  useEffect(() => { if (state.phase === 'ready') { edited.current = false; setMinutes(settings.pomodoroMinutes); } }, [state.phase]);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  if (state.phase === 'ready') return <div className="bubble-card pomodoro-card"><div className="bubble-title">准备专注</div><p className="pomodoro-task">{taskTitle ?? '自由专注'}</p><label className="pomodoro-duration">时长（分钟）<input aria-label="专注分钟数" type="number" min={SIMPLE_SETTING_LIMITS.pomodoroMinutes.min} max={SIMPLE_SETTING_LIMITS.pomodoroMinutes.max} value={minutes} onChange={(e) => { edited.current = true; setMinutes(Number(e.currentTarget.value)); }} /></label><div className="bubble-actions"><button className="primary" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.startPomodoro(state.taskId, minutes, true))}>开始计时</button><button onClick={() => void action.run(() => window.eyeProtect.pomodoroAction('stop'))}>返回待办</button></div>{action.error ? <p role="alert">{action.error.message}</p> : null}</div>;
  const seconds = Math.ceil(state.remainingMs / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const finished = state.phase === 'focus-finished' || state.phase === 'break-finished';
  return <div className="bubble-card pomodoro-card">
    <div className="bubble-title">{state.phase === 'break' ? '休息一下' : state.phase === 'focus-finished' ? '本轮专注结束' : state.phase === 'break-finished' ? '休息结束' : state.running ? '专注中' : '已暂停'}</div>
    <p className="pomodoro-task">{taskTitle ?? '自由专注'}</p>
    {!finished ? <strong className="pomodoro-clock" aria-label="剩余时间">{clock}</strong> : null}
    <div className="bubble-actions">
      {!finished ? <button onClick={() => void action.run(() => window.eyeProtect.pomodoroAction(state.running ? 'pause' : 'resume'))}>{state.running ? '暂停' : '继续'}</button> : null}
      {state.phase === 'focus-finished' ? <button className="primary" onClick={() => void action.run(() => window.eyeProtect.pomodoroAction('break'))}>开始休息 {settings.pomodoroBreakMinutes} 分钟</button> : null}
      {state.phase === 'break-finished' ? <button className="primary" onClick={() => void action.run(() => window.eyeProtect.startPomodoro(state.taskId, settings.pomodoroMinutes, true))}>开始下一轮</button> : null}
      <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.pomodoroAction('stop'))}>{finished ? '返回待办' : '结束'}</button>
    </div>
    {finished ? <label className="pomodoro-duration">下轮专注（分钟）<input type="number" min={1} max={180} key={settings.pomodoroMinutes} defaultValue={settings.pomodoroMinutes} onBlur={(e) => void action.run(() => window.eyeProtect.saveSettings({ pomodoroMinutes: Number(e.currentTarget.value) }))} /></label> : null}
    {action.error ? <p role="alert">{action.error.message}</p> : null}
  </div>;
}
