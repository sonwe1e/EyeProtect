import { Check, ListChecks, X } from 'lucide-react';
import { selectPetTasks } from '../../../shared/petTasks';
import { taskSteps } from '../../../shared/simpleTasks';
import type { Task } from '../../../shared/types';
import { useSettings } from '../hooks/useSettings';
import { useProjects } from '../hooks/useProjects';
import { useTasks } from '../hooks/useTasks';
import { useBubbleLayout } from '../hooks/useBubbleLayout';
import { useCommand } from '../hooks/useCommand';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { usePomodoro } from '../hooks/usePomodoro';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { PomodoroCard } from '../features/simple/PomodoroCard';
import { GentleReminderBubble, PreAlertBubble } from '../features/reminders/ReminderBubble';
import { run } from '../lib/commands';

export default function BubbleView(): JSX.Element {
  const status = useReminderStatus();
  const active = status.activeReminder;
  const preAlert = status.preAlert;
  const tasks = useTasks();
  const projects = useProjects();
  const { settings } = useSettings();
  const pomodoro = usePomodoro();
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  // Hooks must stay unconditional: gentle/prealert surfaces return early, and
  // a late useConfirm() would break hook order when a reminder replaces todos.
  const confirmState = useConfirm();
  const focusing = pomodoro.phase !== 'idle';
  const gentle = active && active.mode === 'gentle' ? active : null;
  // Reminders take precedence over the passive todo preview (the main process
  // sizes the window per surface, see WindowManager#getBubbleSize).
  const surface = preAlert ? 'prealert' : gentle ? `gentle-${gentle.id}` : focusing ? `pomodoro-${pomodoro.phase}` : 'todo';
  useBubbleLayout(surface);

  if (preAlert) return <PreAlertBubble preAlert={preAlert} />;
  if (gentle) return <GentleReminderBubble active={gentle} settings={settings} />;

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
function BubbleTask({ task, tasks, confirm }: { task: Task; tasks: Task[]; confirm: (message: string, options?: string | { title?: string; detail?: string; confirmText?: string; danger?: boolean }) => Promise<boolean> }): JSX.Element {
  const complete = useCommand(() => run(async () => {
    const pending = taskSteps(task.id, tasks).filter((step) => step.status === 'open');
    if (pending.length && !(await confirm(`还有 ${pending.length} 个步骤未完成。`, { title: '一起完成这些步骤？', confirmText: '一起完成' }))) return;
    return window.eyeProtect.completeTaskTree(task.id, Object.fromEntries([task, ...pending].map((entry) => [entry.id, entry.revision])));
  }));
  return <li className="bubble-task-row"><div className="bubble-task-line"><button className="bubble-complete" aria-label={`完成 ${task.title}`} disabled={complete.isPending} onClick={() => void complete.run()}><Check size={14} /></button><button className="bubble-task-title" title={`在工作台打开并定位「${task.title}」`} onClick={() => void window.eyeProtect.openWorkbench('today', task.id)}>{task.title}</button></div>{complete.error ? <span className="bubble-task-error" role="alert">{complete.error.message}</span> : null}</li>;
}
