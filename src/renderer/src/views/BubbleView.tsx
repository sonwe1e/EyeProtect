import { useEffect, useRef, useState } from 'react';
import { Check, Droplet, ListChecks, X } from 'lucide-react';
import { selectPetTasks } from '../../../shared/petTasks';
import { taskSteps } from '../../../shared/simpleTasks';
import { resolveBubbleSurface } from '../../../shared/bubbleSurface';
import type { HydrationStatus, Task } from '../../../shared/types';
import { useSettings } from '../hooks/useSettings';
import { useProjects } from '../hooks/useProjects';
import { useTasks } from '../hooks/useTasks';
import { useBubbleLayout } from '../hooks/useBubbleLayout';
import { useCommand } from '../hooks/useCommand';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { usePomodoro } from '../hooks/usePomodoro';
import { useHydration } from '../hooks/useHydration';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { PomodoroCard } from '../features/simple/PomodoroCard';
import { GentleReminderBubble, PreAlertBubble } from '../features/reminders/ReminderBubble';
import { hydrationBubbleLine } from '../features/reminders/restCopyPool';
import { run } from '../lib/commands';

export default function BubbleView(): JSX.Element {
  const status = useReminderStatus();
  const active = status.activeReminder;
  const preAlert = status.preAlert;
  const tasks = useTasks();
  const projects = useProjects();
  const { settings } = useSettings();
  const pomodoro = usePomodoro();
  const hydration = useHydration();
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  // Hooks must stay unconditional: gentle/prealert surfaces return early, and
  // a late useConfirm() would break hook order when a reminder replaces todos.
  const confirmState = useConfirm();
  const focusing = pomodoro.phase !== 'idle';
  const gentle = active && active.mode === 'gentle' ? active : null;
  // One priority list, shared with the main process that sizes this window.
  const surface = resolveBubbleSurface({
    preAlert: Boolean(preAlert),
    gentleReminderId: gentle?.id ?? null,
    pomodoroPhase: pomodoro.phase,
    hydrationPrompt: hydration?.prompt ?? null
  });
  useBubbleLayout(surface.key);

  if (preAlert) return <PreAlertBubble preAlert={preAlert} />;
  if (gentle) return <GentleReminderBubble active={gentle} settings={settings} />;
  // A hydration strip is a moment the user can act on, so it outranks the
  // passive todo preview; the pet is still visible behind it.
  if (surface.kind === 'hydration' && hydration) return <HydrationStrip status={hydration} />;

  const pending = selectPetTasks(settings.todoBubbleTaskIds, tasks, projects);
  return <div className="bubble-shell bubble-todos">
    <ConfirmDialog pending={confirmState.pending} onResolve={confirmState.resolveConfirm} />
    {focusing ? <PomodoroCard state={pomodoro} taskTitle={tasks.find((task) => task.id === pomodoro.taskId)?.title ?? null} /> : <div className="bubble-card">
      <button className="bubble-close" aria-label="关闭待办气泡" onClick={() => void action.run(() => window.eyeProtect.saveSettings({ todoBubbleEnabled: false }))}><X size={13} /></button>
      <div className="bubble-title"><ListChecks size={13} /><span>{pending.length ? '待办' : '已完成'}</span><span className="bubble-count">{pending.length}</span></div>
      {pending.length ? <ul className="bubble-list" aria-label="已选择的浮窗任务">{pending.map((task) => <BubbleTask key={task.id} task={task} tasks={tasks} confirm={confirmState.confirm} />)}</ul> : <p className="bubble-done-note">休息一下，稍后继续。</p>}
      <div className="bubble-actions"><button onClick={() => void window.eyeProtect.openWorkbench('today')}>{pending.length ? '选择任务' : '去加一个任务'}</button><button onClick={() => void action.run(() => window.eyeProtect.preparePomodoro(null, false))}>开始专注</button></div>
      {action.error ? <p role="alert">{action.error.message}</p> : null}
    </div>}
    <span className="bubble-tail" />
  </div>;
}
function HydrationStrip({ status }: { status: HydrationStatus }): JSX.Element {
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  // The main process owns the deadline; the renderer only animates towards it,
  // so a reload cannot extend the strip and a slow frame cannot extend it either.
  const remainingMs = Math.max(0, (status.prompt?.endsAt ?? Date.now()) - Date.now());
  // Cups decorate the count pill: at most 8 are drawn, and a goal beyond 8
  // folds into a +N capsule (vision §3.1). aria-hidden: the pill is the truth.
  const visibleCups = Math.min(8, Math.max(0, status.goalCups));
  const fullCups = Math.min(status.cups, visibleCups);
  const overflowCups = Math.max(0, status.goalCups - 8);
  // 记一杯 pops only the cup it just filled: a transient index cleared by
  // timeout, so a reload or an unrelated re-render never replays the pop.
  // In folded mode (cups beyond the 8 drawn) the newest cup is not on screen,
  // so no pop fires — the capsule's solid wash is the feedback instead.
  const [fillIndex, setFillIndex] = useState<number | null>(null);
  const prevCups = useRef(status.cups);
  useEffect(() => {
    const cups = status.cups;
    const grew = cups > prevCups.current;
    prevCups.current = cups;
    if (!grew || cups < 1 || cups > visibleCups) return;
    setFillIndex(cups - 1);
    const timer = window.setTimeout(() => setFillIndex(null), 320);
    return () => window.clearTimeout(timer);
  }, [status.cups, visibleCups]);
  // Two ways out and only one of them records: `记一杯` counts, `×` merely ends
  // this moment without asking anything again until the next slot.
  return <div className="bubble-shell bubble-hydration-shell">
    <div className="bubble-card bubble-hydration">
      <button className="bubble-close" aria-label="这次不记" title="这次不记" onClick={() => void action.run(() => window.eyeProtect.dismissHydrationPrompt())}><X size={13} /></button>
      <div className="bubble-title"><Droplet size={13} aria-hidden="true" /><span>喝水</span></div>
      <p className="bubble-hydration-line">{hydrationBubbleLine(status.prompt?.id ?? '') || '我喝了三口。你第几杯了？'}</p>
      <p className={`bubble-hydration-count${status.achieved ? ' is-achieved' : ''}`}>{status.achieved ? `今天 ${status.cups}/${status.goalCups} 杯 · 够了` : `今天 ${status.cups}/${status.goalCups} 杯`}</p>
      <div className="bubble-hydration-cups" aria-hidden="true">
        {Array.from({ length: visibleCups }, (_unused, index) => (
          <i key={index} className={`hydration-cup${index < fullCups ? ' is-full' : ''}${index === fillIndex ? ' did-fill' : ''}`.trim()} />
        ))}
        {overflowCups > 0 ? <span className={`bubble-hydration-overflow${status.cups > 8 ? ' is-goal-folded' : ''}`.trim()}>+{overflowCups}</span> : null}
      </div>
      <div className="bubble-actions"><button className="primary" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.recordHydrationCup())}>记一杯</button></div>
      {action.error ? <p role="alert" className="bubble-error">{action.error.message}</p> : null}
      <i className="bubble-hydration-bar" style={{ animationDuration: `${remainingMs}ms` }} aria-hidden="true" />
    </div>
    <span className="bubble-tail" />
  </div>;
}

function BubbleTask({ task, tasks, confirm }: { task: Task; tasks: Task[]; confirm: (message: string, options?: string | { title?: string; detail?: string; confirmText?: string; danger?: boolean }) => Promise<boolean> }): JSX.Element {
  const complete = useCommand(() => run(async () => {
    const pending = taskSteps(task.id, tasks).filter((step) => step.status === 'open');
    if (pending.length && !(await confirm(`还有 ${pending.length} 个步骤未完成。`, { title: '一起完成这些步骤？', confirmText: '一起完成' }))) return;
    return window.eyeProtect.completeTaskTree(task.id, Object.fromEntries([task, ...pending].map((entry) => [entry.id, entry.revision])));
  }));
  return <li className="bubble-task-row"><div className="bubble-task-line"><button className="bubble-complete" aria-label={`完成 ${task.title}`} disabled={complete.isPending} onClick={() => void complete.run()}><Check size={14} /></button><button className="bubble-task-title" title={`在工作台打开并定位「${task.title}」`} onClick={() => void window.eyeProtect.openWorkbench('today', task.id)}>{task.title}</button></div>{complete.error ? <span className="bubble-task-error" role="alert">{complete.error.message}</span> : null}</li>;
}
