import { useCallback, useEffect, useState } from 'react';
import { Clock3, Plus, Trash2 } from 'lucide-react';
import type { Alarm, AlarmRepeat } from '../../../../shared/types';

const formatAlarmClock = (hour: number, minute: number): string => {
  const hh = `${hour}`.padStart(2, '0');
  const mm = `${minute}`.padStart(2, '0');
  return `${hh}:${mm}`;
};

const clampAlarm = (hour: number, minute: number): { hour: number; minute: number } => ({
  hour: Math.min(23, Math.max(0, Math.round(hour))),
  minute: Math.min(59, Math.max(0, Math.round(minute)))
});

export function AlarmSection({
  alarms,
  onCancel,
  onDirtyChange
}: {
  alarms: Alarm[];
  onCancel: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [minute, setMinute] = useState(() => new Date().getMinutes());
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState<AlarmRepeat>('once');

  useEffect(() => {
    onDirtyChange?.(editorOpen);
    return () => onDirtyChange?.(false);
  }, [editorOpen, onDirtyChange]);

  const submit = useCallback(() => {
    const clamped = clampAlarm(hour, minute);
    void window.eyeProtect.setAlarm({
      hour: clamped.hour,
      minute: clamped.minute,
      label: label.trim() || undefined,
      repeat,
      enabled: true
    });
    setEditorOpen(false);
    setLabel('');
    setRepeat('once');
  }, [hour, minute, label, repeat]);

  return (
    <div className="panel-section">
      <div className="panel-scroll">
        <span className="alarm-section-title">已创建的闹钟</span>
        {alarms.length === 0 ? (
          <p className="alarm-menu-empty">还没有闹钟</p>
        ) : (
          <ul className="alarm-list">
            {alarms.map((alarm) => (
              <li key={alarm.id} className="alarm-list-item">
                <Clock3 size={14} />
                <span className="alarm-time">{formatAlarmClock(alarm.hour, alarm.minute)}</span>
                {alarm.label ? <span className="alarm-label">{alarm.label}</span> : null}
                <span className={`alarm-repeat ${alarm.repeat}`}>
                  {alarm.repeat === 'daily' ? '每天' : '单次'}
                </span>
                <button
                  type="button"
                  className="alarm-remove"
                  title="删除闹钟"
                  onClick={() => onCancel(alarm.id)}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editorOpen ? (
        <div className="alarm-editor">
          <span className="alarm-section-title">新建闹钟</span>
          <div className="alarm-time-inputs">
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(event) => setHour(Number(event.currentTarget.value))}
              aria-label="小时"
            />
            <span className="alarm-time-sep">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(event) => setMinute(Number(event.currentTarget.value))}
              aria-label="分钟"
            />
          </div>
          <input
            className="alarm-label-input"
            type="text"
            placeholder="标签（可选）"
            value={label}
            maxLength={20}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
          <div className="alarm-repeat-toggle">
            <button
              type="button"
              className={repeat === 'once' ? 'is-active' : ''}
              onClick={() => setRepeat('once')}
            >
              单次
            </button>
            <button
              type="button"
              className={repeat === 'daily' ? 'is-active' : ''}
              onClick={() => setRepeat('daily')}
            >
              每天
            </button>
          </div>
          <div className="alarm-editor-actions">
            <button type="button" className="primary" onClick={submit}>
              确定
            </button>
            <button type="button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="alarm-add" onClick={() => setEditorOpen(true)}>
          <Plus size={14} />
          新建闹钟
        </button>
      )}
    </div>
  );
}
