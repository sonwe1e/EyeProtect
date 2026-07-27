import { Check, Clock3, X } from 'lucide-react';
import { ReminderArtwork, reminderCopy } from '../features/reminders/ReminderArtwork';
import { useClock } from '../hooks/useClock';
import { useReminderStatus } from '../hooks/useReminderStatus';

export default function AlertView(): JSX.Element {
  const status = useReminderStatus();
  const now = useClock(1_000);
  const active = status.activeReminder;

  if (!active) {
    return <main className="alert-shell" />;
  }

  const copy = reminderCopy[active.kind];
  const waiting = now < active.unlockAt;
  const waitSeconds = Math.max(0, Math.ceil((active.unlockAt - now) / 1000));
  const snoozeLocked = now < active.snoozeAllowedAt;

  const handleDoubleClick = (): void => {
    if (!waiting) {
      void window.eyeProtect.reminderAction('complete', active.id);
    }
  };

  return (
    <main className="alert-shell">
      <ReminderArtwork active={active} onDoubleClick={handleDoubleClick} />
      <section className="alert-panel">
        <div className="alert-heading">
          <span className={`kind-badge ${active.kind}`}>
            {active.kind === 'eye' ? '护眼' : active.kind === 'walk' ? '走动' : '休息'}
          </span>
          <h1>{copy.title}</h1>
          <p>{copy.detail}</p>
        </div>
        {waiting ? (
          <div className="alert-wait-hint">
            <span className="alert-wait-time">
              {waitSeconds} 秒后{snoozeLocked ? '可「完成」或「稍后」' : '可「完成」'}
            </span>
            <span className="alert-wait-note">「跳过」随时可用</span>
          </div>
        ) : null}
        <div className="alert-actions">
          <button
            className="primary"
            disabled={waiting}
            onClick={() => void window.eyeProtect.reminderAction('complete', active.id)}
          >
            <Check size={18} />
            完成
          </button>
          <button
            disabled={snoozeLocked}
            onClick={() => void window.eyeProtect.reminderAction('snooze', active.id)}
          >
            <Clock3 size={18} />
            稍后
          </button>
          <button onClick={() => void window.eyeProtect.reminderAction('skip', active.id)}>
            <X size={18} />
            跳过
          </button>
        </div>
      </section>
    </main>
  );
}
