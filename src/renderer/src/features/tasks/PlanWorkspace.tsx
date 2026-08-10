import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, Eye, GripVertical } from 'lucide-react';
import type { Task } from '../../../../shared/types';
import { Button, StatusChip } from '../../components/primitives';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';
import { buildTimelineLayout } from './planLayout';
import styles from './PlanWorkspace.module.css';

const DAY_START_MINUTES = 7 * 60;
const DAY_END_MINUTES = 21 * 60;
const PIXELS_PER_MINUTE = 1;
const SNAP_MINUTES = 15;
const TIMELINE_HEIGHT = (DAY_END_MINUTES - DAY_START_MINUTES) * PIXELS_PER_MINUTE;

const startOfDay = (value: number): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const atMinutes = (day: number, minutes: number): number => day + minutes * 60_000;
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const snap = (value: number): number => Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
const formatClock = (timestamp: number): string => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp);

function UnscheduledCard({ task, day, onOpen }: { task: Task; day: number; onOpen: () => void }): JSX.Element {
  const schedule = useCommand((plannedAt: number) => commands.tasks.update(task.id, { plannedAt }));
  return (
    <article
      className="plan-task-card"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-eyeprotect-task', task.id);
      }}
    >
      <button type="button" className="plan-task-title" onClick={onOpen}>{task.title}</button>
      <span>{task.estimateMinutes ? `${task.estimateMinutes} 分钟` : '未估时'}</span>
      <div className="plan-task-actions">
        <Button disabled={schedule.isPending} onClick={() => void schedule.run(atMinutes(day, 9 * 60))}>放到 09:00</Button>
        <span className="plan-drag-hint"><GripVertical size={14} />拖入时间线</span>
      </div>
    </article>
  );
}

function TimelineBlock({ task, day, lane, laneCount, onOpen }: { task: Task; day: number; lane: number; laneCount: number; onOpen: () => void }): JSX.Element {
  const update = useCommand((input: { plannedAt?: number; estimateMinutes?: number }) => commands.tasks.update(task.id, input));
  const plannedAt = task.plannedAt ?? atMinutes(day, 9 * 60);
  const minuteOfDay = new Date(plannedAt).getHours() * 60 + new Date(plannedAt).getMinutes();
  const baseTop = clamp(minuteOfDay - DAY_START_MINUTES, 0, DAY_END_MINUTES - DAY_START_MINUTES - 15);
  const baseDuration = clamp(task.estimateMinutes ?? 30, 15, 8 * 60);
  const [preview, setPreview] = useState<{ top: number; duration: number } | null>(null);
  const top = preview?.top ?? baseTop;
  const duration = preview?.duration ?? baseDuration;

  const beginPointerChange = (event: ReactPointerEvent<HTMLButtonElement>, mode: 'move' | 'resize'): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const originY = event.clientY;
    const originTop = top;
    const originDuration = duration;
    const target = event.currentTarget;
    const onMove = (next: PointerEvent): void => {
      const delta = snap((next.clientY - originY) / PIXELS_PER_MINUTE);
      if (mode === 'move') {
        setPreview({ top: clamp(originTop + delta, 0, DAY_END_MINUTES - DAY_START_MINUTES - originDuration), duration: originDuration });
      } else {
        setPreview({ top: originTop, duration: clamp(originDuration + delta, 15, DAY_END_MINUTES - DAY_START_MINUTES - originTop) });
      }
    };
    const onUp = (next: PointerEvent): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      const delta = snap((next.clientY - originY) / PIXELS_PER_MINUTE);
      if (mode === 'move') {
        const nextTop = clamp(originTop + delta, 0, DAY_END_MINUTES - DAY_START_MINUTES - originDuration);
        void update.run({ plannedAt: atMinutes(day, DAY_START_MINUTES + nextTop) });
      } else {
        const nextDuration = clamp(originDuration + delta, 15, DAY_END_MINUTES - DAY_START_MINUTES - originTop);
        void update.run({ estimateMinutes: nextDuration });
      }
      setPreview(null);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <article
      className={`timeline-block ${update.error ? 'is-error' : ''}`.trim()}
      style={{
        top: top * PIXELS_PER_MINUTE,
        height: duration * PIXELS_PER_MINUTE,
        left: `calc(64px + (100% - 76px) * ${lane} / ${laneCount} + ${lane > 0 ? 3 : 0}px)`,
        right: `calc(12px + (100% - 76px) * ${laneCount - lane - 1} / ${laneCount} + ${lane < laneCount - 1 ? 3 : 0}px)`
      }}
    >
      <button type="button" className="timeline-block-drag" aria-label={`移动「${task.title}」`} onPointerDown={(event) => beginPointerChange(event, 'move')}><GripVertical size={15} /></button>
      <button type="button" className="timeline-block-title" onClick={onOpen}>{task.title}</button>
      <span>{formatClock(atMinutes(day, DAY_START_MINUTES + top))} · {duration} 分钟</span>
      {update.error ? <small>{update.error.message}</small> : null}
      <button type="button" className="timeline-block-resize" aria-label={`调整「${task.title}」时长`} onPointerDown={(event) => beginPointerChange(event, 'resize')} />
    </article>
  );
}

export function PlanWorkspace({ tasks, now, nextEyeAt, onOpen }: { tasks: Task[]; now: number; nextEyeAt: number; onOpen: (id: string) => void }): JSX.Element {
  const today = startOfDay(now);
  const [day, setDay] = useState(today);
  const unscheduled = useMemo(() => tasks.filter((task) => task.status === 'open' && task.plannedAt === null), [tasks]);
  const scheduled = useMemo(() => tasks
    .filter((task) => task.status === 'open' && task.plannedAt !== null && startOfDay(task.plannedAt) === day)
    .sort((left, right) => (left.plannedAt ?? 0) - (right.plannedAt ?? 0)), [tasks, day]);
  const plannedMinutes = scheduled.reduce((sum, task) => sum + (task.estimateMinutes ?? 30), 0);
  const timelineLayout = useMemo(() => buildTimelineLayout(scheduled, day), [scheduled, day]);
  const drop = useCommand((id: string, plannedAt: number) => commands.tasks.update(id, { plannedAt }));
  const eyeMinutes = new Date(nextEyeAt).getHours() * 60 + new Date(nextEyeAt).getMinutes();
  const showEyeMarker = startOfDay(nextEyeAt) === day && eyeMinutes >= DAY_START_MINUTES && eyeMinutes <= DAY_END_MINUTES;

  return (
    <div className={`workspace-page plan-page ${styles.root}`}>
      <header className="page-header">
        <div><span className="page-eyebrow">安排节奏</span><h1>计划</h1></div>
        <div className="plan-day-switch" aria-label="选择计划日期">
          <Button variant="ghost" aria-pressed={day === today} className={day === today ? 'is-active' : ''} onClick={() => setDay(today)}>今天</Button>
          <Button variant="ghost" aria-pressed={day === today + 86_400_000} className={day === today + 86_400_000 ? 'is-active' : ''} onClick={() => setDay(today + 86_400_000)}>明天</Button>
          <StatusChip tone="brand">已计划 {plannedMinutes} 分钟</StatusChip>
        </div>
      </header>
      <div className="plan-layout">
        <section className="plan-column plan-backlog">
          <header><h2>未安排</h2><span>{unscheduled.length}</span></header>
          <p className="plan-column-hint">拖动任务到右侧，或直接安排到上午。</p>
          <div className="plan-task-list">{unscheduled.map((task) => <UnscheduledCard key={task.id} task={task} day={day} onOpen={() => onOpen(task.id)} />)}</div>
        </section>
        <section className="plan-column plan-timeline">
          <header><h2><CalendarDays size={17} />{day === today ? '今天' : '明天'}时间线</h2><span>07:00–21:00</span></header>
          <div
            className="timeline-grid"
            style={{ height: TIMELINE_HEIGHT }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData('application/x-eyeprotect-task');
              if (!id) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const minutes = clamp(snap((event.clientY - bounds.top) / PIXELS_PER_MINUTE) + DAY_START_MINUTES, DAY_START_MINUTES, DAY_END_MINUTES - 15);
              void drop.run(id, atMinutes(day, minutes));
            }}
          >
            {Array.from({ length: 15 }, (_, index) => DAY_START_MINUTES + index * 60).map((minutes) => (
              <div key={minutes} className="timeline-hour" style={{ top: (minutes - DAY_START_MINUTES) * PIXELS_PER_MINUTE }}><span>{String(Math.floor(minutes / 60)).padStart(2, '0')}:00</span></div>
            ))}
            {showEyeMarker ? <div className="timeline-health-marker" style={{ top: (eyeMinutes - DAY_START_MINUTES) * PIXELS_PER_MINUTE }}><Eye size={13} /><span>休息</span></div> : null}
            <div className="timeline-blocks">{scheduled.map((task) => {
              const position = timelineLayout.get(task.id) ?? { lane: 0, count: 1 };
              return <TimelineBlock key={task.id} task={task} day={day} lane={position.lane} laneCount={position.count} onOpen={() => onOpen(task.id)} />;
            })}</div>
          </div>
          {drop.error ? <p className="plan-drop-error" role="alert">{drop.error.message}</p> : null}
        </section>
      </div>
    </div>
  );
}
