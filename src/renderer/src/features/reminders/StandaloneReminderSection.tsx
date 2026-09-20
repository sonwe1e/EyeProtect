import { useMemo, useState, type FormEvent } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import {
  nextStandaloneReminderFireAt,
  type StandaloneReminderSchedule
} from '../../../../shared/types';
import { CommandButton } from '../../components/CommandButton';
import { useClock } from '../../hooks/useClock';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';
import { useStandaloneReminders } from '../../hooks/useStandaloneReminders';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
type ScheduleType = StandaloneReminderSchedule['type'];

const localDateTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function StandaloneReminderSection(): JSX.Element {
  const reminders = useStandaloneReminders();
  // Minute ticks keep the "next fire" timestamps in each row from going stale
  // while the section stays open (the list only re-renders on data changes).
  const now = useClock(60_000);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ScheduleType>('once');
  const [dateTime, setDateTime] = useState(localDateTime(Date.now() + 3_600_000));
  const [clock, setClock] = useState('09:00');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [intervalDays, setIntervalDays] = useState(2);

  const create = useCommand((input: Parameters<typeof commands.reminders.create>[0]) =>
    commands.reminders.create(input)
  );

  const schedule = useMemo<StandaloneReminderSchedule | null>(() => {
    const [hour, minute] = clock.split(':').map(Number);
    if (type === 'once') {
      const fireAt = new Date(dateTime).getTime();
      return Number.isFinite(fireAt) ? { type, fireAt } : null;
    }
    if (type === 'custom') {
      const anchorAt = new Date(dateTime).getTime();
      return Number.isFinite(anchorAt) ? { type, anchorAt, intervalDays } : null;
    }
    if (type === 'weekly') {
      return weekdays.length ? { type, weekdays, hour, minute } : null;
    }
    return { type, hour, minute };
  }, [type, dateTime, clock, weekdays, intervalDays]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!schedule) {
      return;
    }
    void create.run({ label, schedule, enabled: true }).then((result) => {
      if (result.ok) {
        setLabel('');
      }
    });
  };

  return (
    <section className="standalone-reminders">
      <header>
        <div><Bell size={20} /><div><h1>独立提醒</h1><p>与任务和休息共用可靠调度内核。</p></div></div>
      </header>
      <form className="standalone-composer" onSubmit={submit}>
        <input value={label} placeholder="提醒内容" maxLength={80} onChange={(event) => setLabel(event.currentTarget.value)} />
        <select value={type} onChange={(event) => setType(event.currentTarget.value as ScheduleType)}>
          <option value="once">指定日期</option>
          <option value="daily">每天</option>
          <option value="weekdays">工作日</option>
          <option value="weekly">每周</option>
          <option value="custom">每 N 天</option>
        </select>
        {type === 'once' || type === 'custom' ? (
          <input type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.currentTarget.value)} />
        ) : (
          <input type="time" value={clock} onChange={(event) => setClock(event.currentTarget.value)} />
        )}
        {type === 'weekly' ? (
          <div className="weekday-picker">
            {WEEKDAYS.map((day, index) => (
              <button key={day} type="button" className={weekdays.includes(index) ? 'is-active' : ''} onClick={() =>
                setWeekdays((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort())
              }>{day}</button>
            ))}
          </div>
        ) : null}
        {type === 'custom' ? (
          <label className="interval-days">每 <input type="number" min={1} max={365} value={intervalDays} onChange={(event) => setIntervalDays(Math.min(365, Math.max(1, Number(event.currentTarget.value) || 1)))} /> 天</label>
        ) : null}
        <CommandButton type="submit" state={create.state} errorReason={create.error?.message} disabled={!schedule}>
          <Plus size={14} />添加提醒
        </CommandButton>
      </form>
      <ul className="standalone-list">
        {reminders.map((reminder) => (
          <ReminderItem key={reminder.id} reminder={reminder} now={now} />
        ))}
        {reminders.length === 0 ? <li className="empty-state">还没有独立提醒。</li> : null}
      </ul>
    </section>
  );
}

/** One reminder row. Owns its own command state for enable-toggle and delete. */
function ReminderItem({ reminder, now }: { reminder: ReturnType<typeof useStandaloneReminders>[number]; now: number }): JSX.Element {
  const toggle = useCommand((enabled: boolean) => commands.reminders.update(reminder.id, { enabled }));
  const remove = useCommand(() => commands.reminders.remove(reminder.id));

  const next = nextStandaloneReminderFireAt(reminder.schedule, now);

  return (
    <li>
      <label>
        <input
          type="checkbox"
          checked={reminder.enabled}
          disabled={toggle.isPending}
          onChange={(event) => void toggle.run(event.currentTarget.checked)}
        />
      </label>
      <div><strong>{reminder.label || '提醒'}</strong><small>{next ? new Date(next).toLocaleString('zh-CN') : '已结束'}</small></div>
      <CommandButton
        type="button"
        state={remove.state}
        errorReason={remove.error?.message}
        aria-label="删除提醒"
        onClick={() => void remove.run()}
      >
        <Trash2 size={14} />
      </CommandButton>
    </li>
  );
}
