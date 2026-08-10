import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, Eye, GripVertical } from 'lucide-react';
import type { Task } from '../../../../shared/types';
import {
  addLocalDays,
  localDateAtMinutes,
  localDateKey,
  minutesOfLocalDay,
  sameLocalDate,
  startOfLocalDate
} from '../../../../shared/calendar';
import { Button, StatusChip } from '../../components/primitives';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';
import { buildTimelineLayout, PLAN_UNESTIMATED_VISUAL_MINUTES } from './planLayout';
import styles from './PlanWorkspace.module.css';

// Default working window. The timeline EXTENDS beyond it when tasks are
// planned outside — a 06:00 task must render at 06:00, never be silently
// clamped to 07:00 (USERPLAN 1.2 PR0: Plan out-of-hours correctness).
const BASE_START_MINUTES = 7 * 60;
const BASE_END_MINUTES = 21 * 60;
const MIN_BLOCK_MINUTES = 15;
const PIXELS_PER_MINUTE = 1;
const SNAP_MINUTES = 15;

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const snap = (value: number): number => Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
const clockLabel = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const formatClock = (timestamp: number): string => clockLabel(minutesOfLocalDay(timestamp));

/** Visual duration of a block: the real estimate, or a clearly-labelled minimum. */
const blockDuration = (task: Task): number => task.estimateMinutes ?? PLAN_UNESTIMATED_VISUAL_MINUTES;

function UnscheduledCard({ task, day, onOpen }: { task: Task; day: number; onOpen: () => void }): JSX.Element {
  const schedule = useCommand(() => commands.tasks.update(task.id, { plannedAt: localDateAtMinutes(day, 9 * 60) }));
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
        <Button disabled={schedule.isPending} onClick={() => void schedule.run()}>放到 09:00</Button>
        <span className="plan-drag-hint"><GripVertical size={14} />拖入时间线</span>
      </div>
    </article>
  );
}

function TimelineBlock({ task, day, lane, laneCount, windowStartMinutes, windowEndMinutes, onOpen }: {
  task: Task;
  day: number;
  lane: number;
  laneCount: number;
  windowStartMinutes: number;
  windowEndMinutes: number;
  onOpen: () => void;
}): JSX.Element {
  const update = useCommand((input: { plannedAt?: number; estimateMinutes?: number }) => commands.tasks.update(task.id, input));
  const plannedAt = task.plannedAt ?? localDateAtMinutes(day, 9 * 60);
  const estimated = task.estimateMinutes !== null;
  const minuteOfDay = minutesOfLocalDay(plannedAt);
  // The timeline window already covers every scheduled block, so no clamping
  // may hide the true wall-clock time here.
  const baseTop = minuteOfDay - windowStartMinutes;
  const baseDuration = blockDuration(task);
  const [preview, setPreview] = useState<{ top: number; duration: number } | null>(null);
  const top = preview?.top ?? baseTop;
  const duration = preview?.duration ?? baseDuration;
  const windowMinutes = windowEndMinutes - windowStartMinutes;

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
        setPreview({ top: clamp(originTop + delta, 0, windowMinutes - originDuration), duration: originDuration });
      } else {
        setPreview({ top: originTop, duration: clamp(originDuration + delta, MIN_BLOCK_MINUTES, windowMinutes - originTop) });
      }
    };
    const onUp = (next: PointerEvent): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      const delta = snap((next.clientY - originY) / PIXELS_PER_MINUTE);
      if (mode === 'move') {
        const nextTop = clamp(originTop + delta, 0, windowMinutes - originDuration);
        void update.run({ plannedAt: localDateAtMinutes(day, windowStartMinutes + nextTop) });
      } else {
        const nextDuration = clamp(originDuration + delta, MIN_BLOCK_MINUTES, windowMinutes - originTop);
        void update.run({ estimateMinutes: nextDuration });
      }
      setPreview(null);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <article
      className={`timeline-block ${estimated ? '' : 'is-unestimated'} ${update.error ? 'is-error' : ''}`.trim()}
      style={{
        top: top * PIXELS_PER_MINUTE,
        height: duration * PIXELS_PER_MINUTE,
        left: `calc(64px + (100% - 76px) * ${lane} / ${laneCount} + ${lane > 0 ? 3 : 0}px)`,
        right: `calc(12px + (100% - 76px) * ${laneCount - lane - 1} / ${laneCount} + ${lane < laneCount - 1 ? 3 : 0}px)`
      }}
    >
      <button type="button" className="timeline-block-drag" aria-label={`移动「${task.title}」`} onPointerDown={(event) => beginPointerChange(event, 'move')}><GripVertical size={15} /></button>
      <button type="button" className="timeline-block-title" onClick={onOpen}>{task.title}</button>
      <span>{formatClock(localDateAtMinutes(day, windowStartMinutes + top))} · {estimated ? `${duration} 分钟` : '未估时'}</span>
      {update.error ? <small>{update.error.message}</small> : null}
      <button type="button" className="timeline-block-resize" aria-label={`调整「${task.title}」时长`} onPointerDown={(event) => beginPointerChange(event, 'resize')} />
    </article>
  );
}

export function PlanWorkspace({ tasks, now, nextEyeAt, onOpen }: { tasks: Task[]; now: number; nextEyeAt: number; onOpen: (id: string) => void }): JSX.Element {
  const today = startOfLocalDate(now);
  const tomorrow = useMemo(() => addLocalDays(today, 1), [today]);
  const [day, setDay] = useState(today);
  const unscheduled = useMemo(() => tasks.filter((task) => task.status === 'open' && task.plannedAt === null), [tasks]);
  const scheduled = useMemo(() => tasks
    .filter((task) => task.status === 'open' && task.plannedAt !== null && sameLocalDate(task.plannedAt, day))
    .sort((left, right) => (left.plannedAt ?? 0) - (right.plannedAt ?? 0)), [tasks, day]);

  // Honest workload: only tasks with a real estimate contribute minutes.
  // Unestimated tasks are counted, never faked as 30-minute blocks.
  const estimated = scheduled.filter((task) => task.estimateMinutes !== null);
  const plannedMinutes = estimated.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);
  const unestimatedCount = scheduled.length - estimated.length;

  // Dynamic timeline window: the base 07:00–21:00 working hours, extended
  // (hour-aligned) to cover any block planned outside them. Nothing is
  // clamped into the working window.
  const { windowStartMinutes, windowEndMinutes } = useMemo(() => {
    let start = BASE_START_MINUTES;
    let end = BASE_END_MINUTES;
    for (const task of scheduled) {
      const startMinutes = minutesOfLocalDay(task.plannedAt ?? day);
      start = Math.min(start, Math.floor(startMinutes / 60) * 60);
      end = Math.max(end, Math.ceil((startMinutes + blockDuration(task)) / 60) * 60);
    }
    return { windowStartMinutes: clamp(start, 0, BASE_START_MINUTES), windowEndMinutes: clamp(end, BASE_END_MINUTES, 24 * 60) };
  }, [scheduled, day]);
  const windowMinutes = windowEndMinutes - windowStartMinutes;

  const timelineLayout = useMemo(() => buildTimelineLayout(scheduled, day), [scheduled, day]);
  const drop = useCommand((id: string, plannedAt: number) => commands.tasks.update(id, { plannedAt }));
  const eyeMinutes = minutesOfLocalDay(nextEyeAt);
  const showEyeMarker = sameLocalDate(nextEyeAt, day) && eyeMinutes >= windowStartMinutes && eyeMinutes <= windowEndMinutes;
  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let minutes = Math.floor(windowStartMinutes / 60) * 60; minutes <= windowEndMinutes - 60; minutes += 60) {
      marks.push(minutes);
    }
    return marks;
  }, [windowStartMinutes, windowEndMinutes]);
  const dayLabel = sameLocalDate(day, today) ? '今天' : sameLocalDate(day, tomorrow) ? '明天' : localDateKey(day);

  return (
    <div className={`workspace-page plan-page ${styles.root}`}>
      <header className="page-header">
        <div><span className="page-eyebrow">安排节奏</span><h1>计划</h1></div>
        <div className="plan-day-switch" aria-label="选择计划日期">
          <Button variant="ghost" aria-pressed={sameLocalDate(day, today)} className={sameLocalDate(day, today) ? 'is-active' : ''} onClick={() => setDay(today)}>今天</Button>
          <Button variant="ghost" aria-pressed={sameLocalDate(day, tomorrow)} className={sameLocalDate(day, tomorrow) ? 'is-active' : ''} onClick={() => setDay(tomorrow)}>明天</Button>
          <StatusChip tone="brand">
            已计划 {plannedMinutes} 分钟{unestimatedCount > 0 ? ` · 未估时 ${unestimatedCount} 项` : ''}
          </StatusChip>
        </div>
      </header>
      <div className="plan-layout">
        <section className="plan-column plan-backlog">
          <header><h2>未安排</h2><span>{unscheduled.length}</span></header>
          <p className="plan-column-hint">拖动任务到右侧，或直接安排到上午。</p>
          <div className="plan-task-list">{unscheduled.map((task) => <UnscheduledCard key={task.id} task={task} day={day} onOpen={() => onOpen(task.id)} />)}</div>
        </section>
        <section className="plan-column plan-timeline">
          <header><h2><CalendarDays size={17} />{dayLabel}时间线</h2><span>{clockLabel(windowStartMinutes)}–{clockLabel(windowEndMinutes)}</span></header>
          <div
            className="timeline-grid"
            style={{ height: windowMinutes * PIXELS_PER_MINUTE }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData('application/x-eyeprotect-task');
              if (!id) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const minutes = clamp(snap((event.clientY - bounds.top) / PIXELS_PER_MINUTE) + windowStartMinutes, windowStartMinutes, windowEndMinutes - MIN_BLOCK_MINUTES);
              void drop.run(id, localDateAtMinutes(day, minutes));
            }}
          >
            {hourMarks.map((minutes) => (
              <div key={minutes} className="timeline-hour" style={{ top: (minutes - windowStartMinutes) * PIXELS_PER_MINUTE }}><span>{clockLabel(minutes)}</span></div>
            ))}
            {showEyeMarker ? <div className="timeline-health-marker" style={{ top: (eyeMinutes - windowStartMinutes) * PIXELS_PER_MINUTE }}><Eye size={13} /><span>休息</span></div> : null}
            <div className="timeline-blocks">{scheduled.map((task) => {
              const position = timelineLayout.get(task.id) ?? { lane: 0, count: 1 };
              return <TimelineBlock key={task.id} task={task} day={day} lane={position.lane} laneCount={position.count} windowStartMinutes={windowStartMinutes} windowEndMinutes={windowEndMinutes} onOpen={() => onOpen(task.id)} />;
            })}</div>
          </div>
          {drop.error ? <p className="plan-drop-error" role="alert">{drop.error.message}</p> : null}
        </section>
      </div>
    </div>
  );
}
