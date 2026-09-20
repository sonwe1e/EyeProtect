import { useMemo } from 'react';
import { ArrowLeft, CalendarCheck2, Check, Plus, Scale, Sparkles, Sunrise } from 'lucide-react';
import {
  MAX_DAILY_GOALS,
  summarizeDailyCapacity,
  rescheduleTaskToDay
} from '../../../../shared/dailyPlanning';
import {
  addLocalDays,
  endOfLocalDate,
  localDateKey,
  startOfLocalDate
} from '../../../../shared/calendar';
import type { DailyTaskPlan, Settings, Task } from '../../../../shared/types';
import { Button, StatusChip } from '../../components/primitives';
import { useCommand } from '../../hooks/useCommand';
import { useDailyPlans } from '../../hooks/useDailyPlans';
import { commands } from '../../lib/commands';

const formatHours = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
};

/** Step 1 row: one overdue task with 今天 / 明天 / 稍后 triage actions. */
function TriageRow({ task, todayStart, tomorrowStart, todayKey, tomorrowKey, onOpen, onChanged }: {
  task: Task;
  todayStart: number;
  tomorrowStart: number;
  todayKey: string;
  tomorrowKey: string;
  onOpen: (id: string) => void;
  onChanged: () => void;
}): JSX.Element {
  const reschedule = useCommand((id: string, patch: { plannedAt: number | null; baseRevision: number }) =>
    commands.tasks.update(id, patch)
  );
  const plan = useCommand((input: { taskId: string; localDate: string }) =>
    commands.planning.upsert({ ...input, dailyRank: null })
  );
  const unplan = useCommand((id: string) => commands.planning.remove(id, todayKey));

  const moveTo = async (dayStart: number | null, dayKey: string | null): Promise<void> => {
    const result = await reschedule.run(task.id, {
      plannedAt: rescheduleTaskToDay(task, dayStart),
      baseRevision: task.revision
    });
    if (!result.ok) return;
    if (dayKey) {
      const planned = await plan.run({ taskId: task.id, localDate: dayKey });
      if (planned.ok && dayKey === todayKey) onChanged();
    } else {
      const unplanned = await unplan.run(task.id);
      if (unplanned.ok) onChanged();
    }
  };

  const error = reschedule.error?.message ?? plan.error?.message ?? unplan.error?.message;
  return (
    <li className="planning-triage-row">
      <button type="button" className="planning-task-title" onClick={() => onOpen(task.id)}>{task.title}</button>
      <span className="planning-triage-actions">
        <Button disabled={reschedule.isPending || plan.isPending} onClick={() => void moveTo(todayStart, todayKey)}>今天</Button>
        <Button disabled={reschedule.isPending || plan.isPending} onClick={() => void moveTo(tomorrowStart, tomorrowKey)}>明天</Button>
        <Button disabled={reschedule.isPending || unplan.isPending} onClick={() => void moveTo(null, null)}>稍后</Button>
      </span>
      {error ? <small className="planning-error" role="alert">{error}</small> : null}
    </li>
  );
}

/** Step 2 row: one committed task with rank selector and removal. */
function PlannedRow({ plan, task, localDate, isRankLocked, onOpen, onChanged }: {
  plan: DailyTaskPlan;
  task: Task | undefined;
  localDate: string;
  isRankLocked: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}): JSX.Element {
  const rank = useCommand((dailyRank: 1 | 2 | 3 | null) =>
    commands.planning.upsert({ taskId: plan.taskId, localDate, dailyRank })
  );
  const remove = useCommand(() => commands.planning.remove(plan.taskId, localDate));
  return (
    <li className="planning-planned-row">
      <button type="button" className="planning-task-title" onClick={() => task && onOpen(task.id)}>
        {task?.title ?? plan.taskId}
      </button>
      <span className="planning-rank-actions" aria-label="今日目标排序">
        {([1, 2, 3] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={plan.dailyRank === value ? 'is-active' : ''}
            aria-pressed={plan.dailyRank === value}
            aria-label={`今日目标 ${value}`}
            disabled={rank.isPending || (value !== plan.dailyRank && isRankLocked && plan.dailyRank === null)}
            onClick={() => void rank.run(plan.dailyRank === value ? null : value).then((result) => { if (result.ok) onChanged(); })}
          >
            {value}
          </button>
        ))}
      </span>
      <span className="planning-minutes">
        {plan.plannedMinutes ?? task?.estimateMinutes ?? null}
        {plan.plannedMinutes ?? task?.estimateMinutes ? ' 分钟' : '未估时'}
      </span>
      <Button aria-label={`移出今天：${task?.title ?? plan.taskId}`} disabled={remove.isPending} onClick={() => void remove.run().then((result) => { if (result.ok) onChanged(); })}>移除</Button>
      {rank.error ? <small className="planning-error" role="alert">{rank.error.message}</small> : null}
    </li>
  );
}

export function DailyPlanningFlow({ tasks, now, settings, onOpen, onClose, onGoToPlan }: {
  tasks: Task[];
  now: number;
  settings: Settings;
  onOpen: (id: string) => void;
  onClose: () => void;
  onGoToPlan: () => void;
}): JSX.Element {
  const todayStart = startOfLocalDate(now);
  const tomorrowStart = useMemo(() => addLocalDays(todayStart, 1), [todayStart]);
  const todayKey = localDateKey(todayStart);
  const tomorrowKey = localDateKey(tomorrowStart);
  const todayEnd = endOfLocalDate(now);
  const { plans, setPlans, refresh } = useDailyPlans(todayKey);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const plannedTaskIds = useMemo(() => new Set(plans.map((plan) => plan.taskId)), [plans]);
  const rankCount = plans.filter((plan) => plan.dailyRank !== null).length;

  // Step 1: open tasks whose planned/due time already fell before today.
  const overdue = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === 'open' &&
          ((task.plannedAt !== null && task.plannedAt < todayStart) ||
            (task.dueAt !== null && task.dueAt < todayStart))
      ),
    [tasks, todayStart]
  );

  // Step 2 candidates: open, not planned for today, not already due in the past
  // (those belong to the triage step).
  const candidates = useMemo(() => {
    const overdueIds = new Set(overdue.map((task) => task.id));
    return tasks
      .filter(
        (task) =>
          task.status === 'open' &&
          !plannedTaskIds.has(task.id) &&
          !overdueIds.has(task.id) &&
          (task.plannedAt === null || task.plannedAt <= todayEnd)
      )
      .slice(0, 30);
  }, [tasks, overdue, plannedTaskIds, todayEnd]);

  const add = useCommand((taskId: string) =>
    commands.planning.upsert({ taskId, localDate: todayKey, dailyRank: null })
  );

  const summary = useMemo(
    () =>
      summarizeDailyCapacity(plans, taskById, settings.dailyCapacityMinutes, settings.eyeIntervalMinutes),
    [plans, taskById, settings.dailyCapacityMinutes, settings.eyeIntervalMinutes]
  );

  return (
    <div className="workspace-page planning-page">
      <header className="page-header">
        <div><span className="page-eyebrow">每日规划</span><h1>规划今天</h1></div>
        <Button onClick={onClose}><ArrowLeft size={15} />返回今天</Button>
      </header>

      <section className="planning-step">
        <h2><Sunrise size={16} />1 · 昨天留下什么</h2>
        {overdue.length === 0 ? (
          <p className="planning-empty">没有遗留任务，今天是干净的开始。</p>
        ) : (
          <>
            <p className="planning-hint">还有 {overdue.length} 件未完成。逐件决定去向，不要自动堆回今天。</p>
            <ul className="planning-triage-list">
              {overdue.map((task) => (
                <TriageRow
                  key={task.id}
                  task={task}
                  todayStart={todayStart}
                  tomorrowStart={tomorrowStart}
                  todayKey={todayKey}
                  tomorrowKey={tomorrowKey}
                  onOpen={onOpen}
                  onChanged={refresh}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="planning-step">
        <h2><CalendarCheck2 size={16} />2 · 今天做什么</h2>
        <ul className="planning-planned-list">
          {plans.map((plan) => (
            <PlannedRow
              key={plan.taskId}
              plan={plan}
              task={taskById.get(plan.taskId)}
              localDate={todayKey}
              isRankLocked={rankCount >= MAX_DAILY_GOALS}
              onOpen={onOpen}
              onChanged={refresh}
            />
          ))}
        </ul>
        {plans.length === 0 ? <p className="planning-empty">今天还没有承诺，从下面挑几件。</p> : null}
        <p className="planning-hint">
          今日目标最多 {MAX_DAILY_GOALS} 个（已选 {rankCount} 个）——它们代表真正的承诺，与任务优先级无关。
        </p>
        <ul className="planning-candidate-list">
          {candidates.map((task) => (
            <li key={task.id}>
              <button type="button" className="planning-task-title" onClick={() => onOpen(task.id)}>{task.title}</button>
              <span className="planning-minutes">{task.estimateMinutes ? `${task.estimateMinutes} 分钟` : '未估时'}</span>
              <Button
                disabled={add.isPending}
                onClick={() => void add.run(task.id).then((result) => { if (result.ok) setPlans(result.data); })}
              >
                <Plus size={13} />加入今天
              </Button>
            </li>
          ))}
        </ul>
        {add.error ? <p className="planning-error" role="alert">{add.error.message}</p> : null}
      </section>

      <section className="planning-step">
        <h2><Scale size={16} />3 · 今天装得下吗</h2>
        <div className="planning-capacity">
          <StatusChip tone="brand">计划投入 {formatHours(summary.plannedMinutes)}</StatusChip>
          <StatusChip>可工作容量 {formatHours(summary.capacityMinutes)}</StatusChip>
          {summary.unestimatedCount > 0 ? <StatusChip tone="warning">未估时 {summary.unestimatedCount} 项</StatusChip> : null}
          <StatusChip><Sparkles size={13} />预计 {summary.estimatedBreakWindows} 次护眼休息窗口</StatusChip>
        </div>
        {summary.overCommitted ? (
          <p className="planning-overcommit" role="alert">
            计划已超过容量 {formatHours(summary.plannedMinutes - summary.capacityMinutes)}。把一部分移到明天，或承认今天做不完。
          </p>
        ) : (
          <p className="planning-hint">未估时的任务不计入分钟总量——先估时，再谈承诺。</p>
        )}
      </section>

      <section className="planning-step">
        <h2><Check size={16} />4 · 排序还是时间线</h2>
        <p className="planning-hint">
          只保留顺序（灵活执行），或稍后在「日程」页把任务拖进时间线做 Timebox。两种方式都合理，不必强制排时间。
        </p>
        <div className="planning-finish">
          <Button variant="primary" onClick={onClose}>完成规划</Button>
          <Button onClick={onGoToPlan}>去时间线安排</Button>
        </div>
      </section>
    </div>
  );
}
