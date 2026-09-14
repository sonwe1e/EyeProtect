import { Check, ListChecks, X } from 'lucide-react';
import { selectPetTasks } from '../../../shared/petTasks';
import { taskSteps } from '../../../shared/simpleTasks';
import type { Task } from '../../../shared/types';
import { useSettings } from '../hooks/useSettings';
import { useProjects } from '../hooks/useProjects';
import { useTasks } from '../hooks/useTasks';
import { useBubbleLayout } from '../hooks/useBubbleLayout';
import { useCommand } from '../hooks/useCommand';
import { usePomodoro } from '../hooks/usePomodoro';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useConfirm } from '../components/useConfirm';
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
    {focusing ? <PomodoroCard state={pomodoro} taskTitle={tasks.find((task) => task.id === pomodoro.taskId)?.title ?? null} /> : <div className="bubble-card">
      <button className="bubble-close" aria-label="关闭待办气泡" onClick={() => void action.run(() => window.eyeProtect.saveSettings({ todoBubbleEnabled: false }))}><X size={13} /></button>
      <div className="bubble-title"><ListChecks size={13} /><span>{pending.length ? '待办' : '已完成'}</span><span className="bubble-count">{pending.length}</span></div>
      {pending.length ? <ul className="bubble-list" aria-label="已选择的浮窗任务">{pending.map((task) => <BubbleTask key={task.id} task={task} tasks={tasks} />)}</ul> : <p className="bubble-done-note">休息一下，稍后继续。</p>}
      <div className="bubble-actions"><button onClick={() => void window.eyeProtect.openWorkbench('today')}>选择任务</button><button onClick={() => void action.run(() => window.eyeProtect.preparePomodoro(null, false))}>开始专注</button></div>
      {action.error ? <p role="alert">{action.error.message}</p> : null}
    </div>}
    <span className="bubble-tail" />
  </div>;
}
function BubbleTask({ task, tasks }: { task: Task; tasks: Task[] }): JSX.Element {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const complete = useCommand(() => run(async () => {
    const pending = taskSteps(task.id, tasks).filter((step) => step.status === 'open');
    if (pending.length) {
      const ok = await confirm({
        title: '还有未完成步骤',
        description: `还有 ${pending.length} 个步骤未完成，是否一起完成？`,
        confirmLabel: '一起完成'
      });
      if (!ok) return;
    }
    return window.eyeProtect.completeTaskTree(task.id, Object.fromEntries([task, ...pending].map((entry) => [entry.id, entry.revision])));
  }));
  return <li className="bubble-task-row">
    <div className="bubble-task-line">
      <button className="bubble-complete" aria-label={`完成 ${task.title}`} disabled={complete.isPending} onClick={() => void complete.run()}><Check size={14} /></button>
      <button className="bubble-task-title" title={task.title} onClick={() => void window.eyeProtect.openWorkbench('today')}>{task.title}</button>
    </div>
    {complete.error ? <span className="bubble-task-error" role="alert">{complete.error.message}</span> : null}
    {confirmDialog}
  </li>;
}
