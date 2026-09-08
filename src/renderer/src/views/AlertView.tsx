import { useReminderStatus } from '../hooks/useReminderStatus';
import { usePomodoro } from '../hooks/usePomodoro';
import { useClock } from '../hooks/useClock';
import { useSettings } from '../hooks/useSettings';
import { useCommand } from '../hooks/useCommand';
import { run } from '../lib/commands';
import { useActiveCharacter } from '../hooks/useCharacterCollection';
import { ProceduralCharacter } from '../features/characters/ProceduralCharacter';

export default function AlertView(): JSX.Element {
  const { activeReminder: active } = useReminderStatus();
  const now = useClock(1000);
  const pomodoro = usePomodoro();
  const { settings } = useSettings();
  const character = useActiveCharacter();
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  if (!active) return <main className="alert-shell" />;
  const started = typeof active.restStartedAt === 'number';
  const remaining = Math.max(0, Math.ceil((active.unlockAt - now) / 1000));
  return <main className="alert-shell simple-rest">
    <div className="simple-rest-character"><ProceduralCharacter character={character} action={started ? active.kind : 'idle'} /></div>
    <h1>{active.kind === 'eye' ? '让眼睛休息一下' : active.kind === 'walk' ? '起来走动一下' : '离开屏幕，起来走动一下'}</h1>
    <p>{started ? remaining > 0 ? `还有 ${remaining} 秒` : '这次休息时间已到' : pomodoro.phase === 'focus-finished' || pomodoro.phase === 'break' ? '将与本轮番茄休息合并，点击开始休息。' : '准备好后，点击开始休息。'}</p>
    <div className="bubble-actions">
      {!started ? <button className="primary" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.beginHealthRest(active.id))}>开始休息</button> : <button className="primary" disabled={remaining > 0 || action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('complete', active.id))}>完成休息</button>}
      <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('snooze', active.id))}>稍后提醒</button>
      <select aria-label="稍后分钟数" value={settings.snoozeMinutes} onChange={(e) => void action.run(() => window.eyeProtect.saveSettings({ snoozeMinutes: Number(e.currentTarget.value) }))}>{[1, 5, 10, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select>
      <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('skip', active.id))}>跳过</button>
    </div>
    {action.error ? <p role="alert">{action.error.message}</p> : null}
  </main>;
}
