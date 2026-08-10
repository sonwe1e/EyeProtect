import { CheckCircle2, Eye, Pause, Play, Target } from 'lucide-react';
import type { Task } from '../../../../shared/types';
import { CommandButton } from '../../components/CommandButton';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';
import styles from './FocusSurface.module.css';

const formatMinutes = (value: number): string => `${Math.max(0, Math.floor(value / 60_000))}m`;

function FocusSubtask({ task }: { task: Task }): JSX.Element {
  const toggle = useCommand((status: Task['status']) => commands.tasks.setStatus(task.id, status));
  return (
    <CommandButton
      variant="ghost"
      state={toggle.state}
      errorReason={toggle.error?.message}
      className={task.status === 'done' ? 'is-done' : ''}
      onClick={() => void toggle.run(task.status === 'done' ? 'open' : 'done')}
    >
      {task.status === 'done' ? <CheckCircle2 size={16} /> : <span className="focus-subtask-circle" />}
      {task.title}
    </CommandButton>
  );
}

export function FocusSurface({ activeTask, candidates, tasks, activeMs, eyeRemaining, onOpen }: {
  activeTask: Task | null;
  candidates: Task[];
  tasks: Task[];
  activeMs: number;
  eyeRemaining: number;
  onOpen: (id: string) => void;
}): JSX.Element {
  const setActive = useCommand((id: string | null) => commands.tasks.setActive(id));
  const complete = useCommand((id: string) => commands.tasks.setStatus(id, 'done'));

  if (!activeTask) {
    return (
      <section className={`${styles.root} focus-empty`}>
        <Target size={32} />
        <h2>选择一件事，安静地开始</h2>
        <p>专注时会收起导航噪音，同时保留下一次护眼休息提示。</p>
        <div className="focus-candidates">
          {candidates.slice(0, 5).map((task) => (
            <CommandButton key={task.id} className="focus-candidate" state={setActive.state} errorReason={setActive.error?.message} onClick={() => void setActive.run(task.id)}>
              <Play size={16} /><span>{task.title}</span>
            </CommandButton>
          ))}
        </div>
      </section>
    );
  }

  const estimateMs = (activeTask.estimateMinutes ?? 0) * 60_000;
  const progress = estimateMs > 0 ? Math.min(100, Math.round(activeMs / estimateMs * 100)) : null;
  const subtasks = tasks.filter((task) => task.parentId === activeTask.id && task.status !== 'archived');
  return (
    <section className={`${styles.root} focus-surface`}>
      <span className="focus-eyebrow">{activeTask.projectId ? '当前项目任务' : '当前任务'}</span>
      <button type="button" className="focus-title" onClick={() => onOpen(activeTask.id)}>{activeTask.title}</button>
      <strong className="focus-timer">{formatMinutes(activeMs)}</strong>
      <span className="focus-progress">{activeTask.estimateMinutes ? `已工作 / ${activeTask.estimateMinutes}m${progress !== null ? ` · ${progress}%` : ''}` : '自由专注'}</span>
      <div className="focus-break-hint"><Eye size={17} />下一次护眼 {formatMinutes(eyeRemaining)}</div>
      {subtasks.length ? <div className="focus-subtasks" aria-label="当前任务的步骤">{subtasks.map((task) => <FocusSubtask key={task.id} task={task} />)}</div> : null}
      <div className="focus-actions">
        <CommandButton variant="secondary" state={setActive.state} errorReason={setActive.error?.message} onClick={() => void setActive.run(null)}><Pause size={16} />暂停专注</CommandButton>
        <CommandButton variant="primary" state={complete.state} errorReason={complete.error?.message} onClick={() => void complete.run(activeTask.id)}><CheckCircle2 size={16} />完成任务</CommandButton>
      </div>
      <span className="focus-footer">EyeProtect · 安静工作中</span>
    </section>
  );
}
