import { useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, Eye, Footprints, GripVertical } from 'lucide-react';
import type { Project, Task, TimeBlock } from '../../../../shared/types';
import { isTaskAvailableForPlanning } from '../../../../shared/projectPolicy';
import {
  addLocalDays,
  endOfLocalDate,
  localDateAtMinutes,
  localDateKey,
  minutesOfLocalDay,
  sameLocalDate,
  startOfLocalDate
} from '../../../../shared/calendar';
import { Button, StatusChip } from '../../components/primitives';
import { useCommand } from '../../hooks/useCommand';
import { useDailyPlans } from '../../hooks/useDailyPlans';
import { useSettings } from '../../hooks/useSettings';
import { useTimeBlocks } from '../../hooks/useTimeBlocks';
import { commands } from '../../lib/commands';
import { buildBlockLayout, shiftPlanSelection, timelineBlockDensity } from './planLayout';
import styles from './PlanWorkspace.module.css';

const PIXELS_PER_MINUTE = 1;
const SNAP_MINUTES = 15;
const MIN_BLOCK_MINUTES = 15;
/** A dropped card without an estimate gets a real, visible 30-minute block —
 * the block itself is the commitment; nothing pretends to be a task estimate. */
const DEFAULT_DROP_MINUTES = 30;
const STRIP_DAYS = 7;
const TASK_DRAG_TYPE = 'application/x-eyeprotect-task';
const BLOCK_DRAG_TYPE = 'application/x-eyeprotect-timeblock';

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const snap = (value: number): number => Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
const clockLabel = (minutes: number): string =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;

function UnscheduledCard({ task, day, ranked, scheduledCount, scheduledMinutes, onOpen, onScheduled }: {
  task: Task;
  day: number;
  ranked: number | null;
  scheduledCount: number;
  scheduledMinutes: number;
  onOpen: () => void;
  onScheduled: () => void;
}): JSX.Element {
  const schedule = useCommand(() =>
    commands.timeBlocks.create({
      taskId: task.id,
      startAt: localDateAtMinutes(day, 9 * 60),
      endAt: localDateAtMinutes(day, 9 * 60 + (task.estimateMinutes ?? DEFAULT_DROP_MINUTES)),
      source: 'planner'
    })
  );
  return (
    <article
      className="plan-task-card"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
      }}
    >
      <button type="button" className="plan-task-title" onClick={onOpen}>
        {ranked !== null ? <span className="plan-rank-badge">{ranked}</span> : null}
        {task.title}
      </button>
      <span>{scheduledCount > 0 ? `已排 ${scheduledCount} 块 · ${scheduledMinutes}m` : task.estimateMinutes ? `${task.estimateMinutes} 分钟` : '未估时'}</span>
      <div className="plan-task-actions">
        <Button
          disabled={schedule.isPending}
          onClick={() => void schedule.run().then((result) => { if (result.ok) onScheduled(); })}
        >
          放到 09:00
        </Button>
        <span className="plan-drag-hint"><GripVertical size={14} />拖入时间线</span>
      </div>
      {schedule.error ? <small className="plan-card-error" role="alert">{schedule.error.message}</small> : null}
    </article>
  );
}

function BlockView({ block, task, windowStartMinutes, windowEndMinutes, day, lane, laneCount, onOpen, onChanged }: {
  block: TimeBlock;
  task: Task | undefined;
  windowStartMinutes: number;
  windowEndMinutes: number;
  day: number;
  lane: number;
  laneCount: number;
  onOpen: () => void;
  onChanged: () => void;
}): JSX.Element {
  const update = useCommand((input: { startAt: number; endAt: number }) => commands.timeBlocks.update(block.id, input));
  const remove = useCommand(() => commands.timeBlocks.remove(block.id));
  const dayStart = startOfLocalDate(day);
  const dayEnd = endOfLocalDate(day);
  const startMinutes = minutesOfLocalDay(Math.max(block.startAt, dayStart));
  const durationMinutes = Math.max(
    MIN_BLOCK_MINUTES,
    Math.round((Math.min(block.endAt, dayEnd) - Math.max(block.startAt, dayStart)) / 60_000)
  );
  const [preview, setPreview] = useState<{ top: number; duration: number } | null>(null);
  const baseTop = clamp(startMinutes - windowStartMinutes, 0, windowEndMinutes - windowStartMinutes - MIN_BLOCK_MINUTES);
  const top = preview?.top ?? baseTop;
  const duration = preview?.duration ?? durationMinutes;
  const density = timelineBlockDensity(duration);
  const windowMinutes = windowEndMinutes - windowStartMinutes;

  const commitMove = (nextTop: number, nextDuration: number): void => {
    const startAt = localDateAtMinutes(day, windowStartMinutes + nextTop);
    const endAt = localDateAtMinutes(day, windowStartMinutes + nextTop + nextDuration);
    void update.run({ startAt, endAt }).then((result) => { if (result.ok) onChanged(); });
  };

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
    let ended = false;
    const cleanup = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      target.removeEventListener('lostpointercapture', onCancel);
      setPreview(null);
    };
    const onUp = (next: PointerEvent): void => {
      if (ended) return;
      ended = true;
      cleanup();
      const delta = snap((next.clientY - originY) / PIXELS_PER_MINUTE);
      if (mode === 'move') {
        commitMove(clamp(originTop + delta, 0, windowMinutes - originDuration), originDuration);
      } else {
        commitMove(originTop, clamp(originDuration + delta, MIN_BLOCK_MINUTES, windowMinutes - originTop));
      }
    };
    const onCancel = (): void => {
      if (ended) return;
      ended = true;
      cleanup();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('lostpointercapture', onCancel);
  };

  // Keyboard scheduling (USERPLAN §十二): arrows move by one snap step,
  // Shift+arrows resize, Delete removes the block. While an update is in
  // flight the next keypress would be computed from the stale pre-move
  // geometry (and either dropped or applied wrongly), so ignore it.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (update.isPending || remove.isPending) return;
    const step = SNAP_MINUTES;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -step : step;
      if (event.shiftKey) {
        commitMove(top, clamp(duration + direction, MIN_BLOCK_MINUTES, windowMinutes - top));
      } else {
        commitMove(clamp(top + direction, 0, windowMinutes - duration), duration);
      }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void remove.run().then((result) => { if (result.ok) onChanged(); });
    }
  };

  const error = update.error?.message ?? remove.error?.message;
  return (
    <article
      className={`timeline-block is-${density} ${error ? 'is-error' : ''}`.trim()}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(BLOCK_DRAG_TYPE, block.id);
      }}
      tabIndex={0}
      aria-label={`时间块：${task?.title ?? block.taskId}，${clockLabel(windowStartMinutes + top)} 开始，${duration} 分钟`}
      onKeyDown={onKeyDown}
      style={{
        top: top * PIXELS_PER_MINUTE,
        height: duration * PIXELS_PER_MINUTE,
        left: `calc(64px + (100% - 76px) * ${lane} / ${laneCount} + ${lane > 0 ? 3 : 0}px)`,
        right: `calc(12px + (100% - 76px) * ${laneCount - lane - 1} / ${laneCount} + ${lane < laneCount - 1 ? 3 : 0}px)`
      }}
    >
      <button type="button" className="timeline-block-drag" aria-label={`移动「${task?.title ?? '任务'}」`} onPointerDown={(event) => beginPointerChange(event, 'move')}><GripVertical size={15} /></button>
      <button type="button" className="timeline-block-title" onClick={onOpen}>{task?.title ?? block.taskId}</button>
      {density !== 'micro' ? <span>{clockLabel(windowStartMinutes + top)}{density === 'full' ? ` · ${duration} 分钟` : ''}</span> : null}
      {error ? <small>{error}</small> : null}
      <button
        type="button"
        className="timeline-block-remove"
        title="移出时间线"
        aria-label={`将「${task?.title ?? '任务'}」的这个时间块移出时间线`}
        onClick={() => void remove.run().then((result) => { if (result.ok) onChanged(); })}
      ><CalendarX2 size={13} /></button>
      <button type="button" className="timeline-block-resize" aria-label={`调整「${task?.title ?? '任务'}」时长`} onPointerDown={(event) => beginPointerChange(event, 'resize')} />
    </article>
  );
}

export function PlanWorkspace({ tasks, projects, now, nextEyeAt, nextWalkAt, onOpen }: {
  tasks: Task[];
  projects: readonly Project[];
  now: number;
  nextEyeAt: number;
  nextWalkAt: number;
  onOpen: (id: string) => void;
}): JSX.Element {
  const { settings } = useSettings();
  const today = startOfLocalDate(now);
  const [stripAnchor, setStripAnchor] = useState(today);
  const [day, setDay] = useState(today);
  const { blocks, refresh } = useTimeBlocks();
  const { plans } = useDailyPlans(localDateKey(day));

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const dayKey = localDateKey(day);
  const plannedByTask = useMemo(() => new Map(plans.map((plan) => [plan.taskId, plan])), [plans]);

  const stripDays = useMemo(() => {
    const start = addLocalDays(stripAnchor, -Math.floor(STRIP_DAYS / 2));
    return Array.from({ length: STRIP_DAYS }, (_, index) => addLocalDays(start, index));
  }, [stripAnchor]);

  const blocksOfDay = useMemo(
    () =>
      blocks
        .filter((block) => sameLocalDate(block.startAt, day))
        .sort((left, right) => left.startAt - right.startAt),
    [blocks, day]
  );

  // Left column: tasks committed to this day (DailyTaskPlan) first, then the
  // rest of the open backlog. Tasks remain here after scheduling so one task
  // can be split into any number of independent TimeBlocks.
  const blockStatsByTask = useMemo(() => {
    const stats = new Map<string, { count: number; minutes: number }>();
    for (const block of blocksOfDay) {
      const current = stats.get(block.taskId) ?? { count: 0, minutes: 0 };
      current.count += 1;
      current.minutes += Math.round((block.endAt - block.startAt) / 60_000);
      stats.set(block.taskId, current);
    }
    return stats;
  }, [blocksOfDay]);
  const committed = useMemo(
    () =>
      plans
        .slice()
        .sort((left, right) => (left.dailyRank ?? 99) - (right.dailyRank ?? 99) || left.sortOrder - right.sortOrder)
        .map((plan) => taskById.get(plan.taskId))
        .filter((task): task is Task => Boolean(task && task.status === 'open' && isTaskAvailableForPlanning(task, task.projectId ? projectById.get(task.projectId) : undefined))),
    [plans, taskById, projectById]
  );
  const backlog = useMemo(
    () => {
      const committedIds = new Set(committed.map((task) => task.id));
      return tasks
        .filter((task) => task.status === 'open' && !committedIds.has(task.id) && isTaskAvailableForPlanning(task, task.projectId ? projectById.get(task.projectId) : undefined))
        .slice(0, 30);
    },
    [tasks, committed, projectById]
  );

  // Timeline window: the configured working hours, extended (hour-aligned)
  // to cover any block living outside them. Nothing gets clamped away.
  const { windowStartMinutes, windowEndMinutes } = useMemo(() => {
    let start = settings.workStartMinutes;
    let end = settings.workEndMinutes;
    const dayStart = startOfLocalDate(day);
    const dayEnd = endOfLocalDate(day);
    for (const block of blocksOfDay) {
      const startMinutes = minutesOfLocalDay(Math.max(block.startAt, dayStart));
      const endMinutes = Math.min(
        Math.ceil((Math.min(block.endAt, dayEnd) - Math.max(block.startAt, dayStart)) / 60_000) + startMinutes,
        24 * 60
      );
      start = Math.min(start, Math.floor(startMinutes / 60) * 60);
      end = Math.max(end, Math.ceil(endMinutes / 60) * 60);
    }
    return {
      windowStartMinutes: clamp(start, 0, settings.workStartMinutes),
      windowEndMinutes: clamp(end, settings.workEndMinutes, 24 * 60)
    };
  }, [blocksOfDay, day, settings.workStartMinutes, settings.workEndMinutes]);
  const windowMinutes = windowEndMinutes - windowStartMinutes;

  const layout = useMemo(() => buildBlockLayout(blocksOfDay), [blocksOfDay]);
  const drop = useCommand((taskId: string, startAt: number, endAt: number) =>
    commands.timeBlocks.create({ taskId, startAt, endAt, source: 'planner' })
  );
  const unschedule = useCommand((blockId: string) => commands.timeBlocks.remove(blockId));
  const scheduledMinutes = blocksOfDay.reduce(
    (sum, block) => sum + Math.round((block.endAt - block.startAt) / 60_000),
    0
  );
  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let minutes = Math.floor(windowStartMinutes / 60) * 60; minutes <= windowEndMinutes - 60; minutes += 60) {
      marks.push(minutes);
    }
    return marks;
  }, [windowStartMinutes, windowEndMinutes]);

  const markerFor = useCallback((timestamp: number): number | null => {
    if (!sameLocalDate(timestamp, day)) return null;
    const minutes = minutesOfLocalDay(timestamp);
    return minutes >= windowStartMinutes && minutes <= windowEndMinutes ? minutes : null;
  }, [day, windowStartMinutes, windowEndMinutes]);
  const eyeMinutes = markerFor(nextEyeAt);
  const walkMinutes = markerFor(nextWalkAt);

  const dayLabel = sameLocalDate(day, today)
    ? '今天'
    : sameLocalDate(day, addLocalDays(today, 1))
      ? '明天'
      : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(day));

  const shiftWeek = (offset: number): void => {
    const shifted = shiftPlanSelection(stripAnchor, day, offset);
    setStripAnchor(shifted.stripAnchor);
    setDay(shifted.selectedDay);
  };

  return (
    <div className={`workspace-page plan-page ${styles.root}`}>
      <header className="page-header">
        <div className="plan-heading">
          <span className="page-eyebrow">安排节奏</span><h1>日程</h1>
          <p className="page-description">把任务安排到具体时间段；不排时间也可以完成。</p>
          <StatusChip tone="brand">已排 {scheduledMinutes} 分钟 · {blocksOfDay.length} 块</StatusChip>
        </div>
        <div className="plan-day-switch" aria-label="选择计划日期">
          <Button variant="ghost" aria-label="上一周" onClick={() => shiftWeek(-STRIP_DAYS)}><ChevronLeft size={15} /></Button>
          {stripDays.map((entry) => (
            <Button
              key={entry}
              variant="ghost"
              aria-pressed={sameLocalDate(entry, day)}
              className={sameLocalDate(entry, day) ? 'is-active' : ''}
              onClick={() => setDay(entry)}
            >
              <span>{sameLocalDate(entry, today) ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(entry))}</span>
              <strong>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(entry))}</strong>
            </Button>
          ))}
          <Button variant="ghost" aria-label="下一周" onClick={() => shiftWeek(STRIP_DAYS)}><ChevronRight size={15} /></Button>
        </div>
      </header>
      <div className="plan-layout">
        <section
          className={`plan-column plan-backlog ${unschedule.isPending ? 'is-drop-pending' : ''}`.trim()}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(event) => {
            const blockId = event.dataTransfer.getData(BLOCK_DRAG_TYPE);
            if (!blockId) return;
            event.preventDefault();
            void unschedule.run(blockId).then((result) => { if (result.ok) refresh(); });
          }}
        >
          <header><h2>{dayLabel}待安排</h2><span>{committed.length + backlog.length}</span></header>
          <p className="plan-column-hint">拖动任务到右侧时间线，或点击「放到 09:00」。一个任务可以拆成多个时间块。</p>
          {committed.length ? <h3 className="plan-group-label">今日承诺</h3> : null}
          <div className="plan-task-list">
            {committed.map((task) => (
              <UnscheduledCard
                key={task.id}
                task={task}
                day={day}
                ranked={plannedByTask.get(task.id)?.dailyRank ?? null}
                scheduledCount={blockStatsByTask.get(task.id)?.count ?? 0}
                scheduledMinutes={blockStatsByTask.get(task.id)?.minutes ?? 0}
                onOpen={() => onOpen(task.id)}
                onScheduled={refresh}
              />
            ))}
          </div>
          {backlog.length ? <h3 className="plan-group-label">其他任务</h3> : null}
          <div className="plan-task-list">
            {backlog.map((task) => (
              <UnscheduledCard
                key={task.id}
                task={task}
                day={day}
                ranked={null}
                scheduledCount={blockStatsByTask.get(task.id)?.count ?? 0}
                scheduledMinutes={blockStatsByTask.get(task.id)?.minutes ?? 0}
                onOpen={() => onOpen(task.id)}
                onScheduled={refresh}
              />
            ))}
          </div>
          {unschedule.error ? <p className="plan-card-error" role="alert">{unschedule.error.message}</p> : null}
        </section>
        <section className="plan-column plan-timeline">
          <header>
            <h2><CalendarDays size={17} />{dayLabel}时间线</h2>
            <span>{clockLabel(windowStartMinutes)}–{clockLabel(windowEndMinutes)}{windowStartMinutes < settings.workStartMinutes || windowEndMinutes > settings.workEndMinutes ? '（含工作时间之外）' : ''}</span>
          </header>
          <div
            className="timeline-grid"
            style={{ height: windowMinutes * PIXELS_PER_MINUTE }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData(TASK_DRAG_TYPE);
              if (!id) return;
              const task = taskById.get(id);
              const bounds = event.currentTarget.getBoundingClientRect();
              const startMinutes = clamp(
                snap((event.clientY - bounds.top) / PIXELS_PER_MINUTE) + windowStartMinutes,
                windowStartMinutes,
                windowEndMinutes - MIN_BLOCK_MINUTES
              );
              const durationMinutes = Math.min(task?.estimateMinutes ?? DEFAULT_DROP_MINUTES, windowEndMinutes - startMinutes);
              void drop.run(
                id,
                localDateAtMinutes(day, startMinutes),
                localDateAtMinutes(day, startMinutes + durationMinutes)
              ).then((result) => { if (result.ok) refresh(); });
            }}
          >
            {hourMarks.map((minutes) => (
              <div key={minutes} className="timeline-hour" style={{ top: (minutes - windowStartMinutes) * PIXELS_PER_MINUTE }}><span>{clockLabel(minutes)}</span></div>
            ))}
            {eyeMinutes !== null ? (
              <div className="timeline-health-marker" style={{ top: (eyeMinutes - windowStartMinutes) * PIXELS_PER_MINUTE }}>
                <span className="timeline-health-marker__label"><Eye size={13} /><span>护眼</span></span>
              </div>
            ) : null}
            {walkMinutes !== null ? (
              <div className="timeline-health-marker timeline-health-marker--walk" style={{ top: (walkMinutes - windowStartMinutes) * PIXELS_PER_MINUTE }}>
                <span className="timeline-health-marker__label"><Footprints size={13} /><span>走动</span></span>
              </div>
            ) : null}
            <div className="timeline-blocks">{blocksOfDay.map((block) => {
              const position = layout.get(block.id) ?? { lane: 0, count: 1 };
              return (
                <BlockView
                  key={block.id}
                  block={block}
                  task={taskById.get(block.taskId)}
                  day={day}
                  windowStartMinutes={windowStartMinutes}
                  windowEndMinutes={windowEndMinutes}
                  lane={position.lane}
                  laneCount={position.count}
                  onOpen={() => onOpen(block.taskId)}
                  onChanged={refresh}
                />
              );
            })}</div>
          </div>
          {drop.error ? <p className="plan-drop-error" role="alert">{drop.error.message}</p> : null}
          <p className="plan-timeline-hint">护眼/走动标记只是节奏参考，不会移动你的时间块。键盘：↑↓ 移动，Shift+↑↓ 调整时长，Delete 删除。</p>
        </section>
      </div>
    </div>
  );
}
