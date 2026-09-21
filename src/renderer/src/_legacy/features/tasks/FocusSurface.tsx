import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Coffee, Eye, Pause, Play, Target } from 'lucide-react';
import type { FocusStatus, Task, TaskCheckpointDraft, TaskStatus } from '../../../../../shared/types';
import { CommandButton } from '../../../components/CommandButton';
import { Button, Dialog, Field } from '../../../components/primitives';
import { useCommand } from '../../../hooks/useCommand';
import { commands } from '../../../lib/commands';
import { completeTaskThenFocus } from '../../../features/tasks/focusCompletion';
import styles from './FocusSurface.module.css';

const formatMinutes = (value: number): string => `${Math.max(0, Math.floor(value / 60_000))}m`;

const formatClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

function FocusSubtask({ task }: { task: Task }): JSX.Element {
  const toggle = useCommand((status: TaskStatus) => commands.tasks.setStatus(task.id, status));
  return (
    <CommandButton
      variant="ghost"
      state={toggle.state}
      successFeedback="none"
      errorReason={toggle.error?.message}
      className={task.status === 'done' ? 'is-done' : ''}
      onClick={() => void toggle.run(task.status === 'done' ? 'open' : 'done')}
    >
      {task.status === 'done' ? <CheckCircle2 size={16} /> : <span className="focus-subtask-circle" />}
      {task.title}
    </CommandButton>
  );
}

function FocusCandidate({ task, onStartFocus }: { task: Task; onStartFocus: (id: string) => void }): JSX.Element {
  return (
    <Button className="focus-candidate" onClick={() => onStartFocus(task.id)}>
      <Play size={16} /><span>{task.title}</span>
    </Button>
  );
}

export function FocusSurface({ activeTask, candidates, tasks, focus, immersive, liveSegmentMs, eyeRemaining, onOpen, onBack, onStartFocus }: {
  activeTask: Task | null;
  candidates: Task[];
  tasks: Task[];
  focus: FocusStatus;
  immersive: boolean;
  /** Work tracker's un-checkpointed live segment — keeps the timer second-smooth. */
  liveSegmentMs: number;
  eyeRemaining: number;
  onOpen: (id: string) => void;
  onBack: () => void;
  onStartFocus: (id: string) => void;
}): JSX.Element {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseProgress, setPauseProgress] = useState('');
  const [pauseNextStep, setPauseNextStep] = useState('');
  const [pauseFeeling, setPauseFeeling] = useState('');
  const pause = useCommand((checkpoint: TaskCheckpointDraft | null) => commands.focus.pause(checkpoint));
  const finish = useCommand((id: string) => completeTaskThenFocus(
    id,
    (taskId) => commands.tasks.setStatus(taskId, 'done'),
    () => commands.focus.complete()
  ));

  const session = focus.session;

  if (!activeTask) {
    return (
      <section className={`${styles.root} focus-empty`}>
        <Target size={32} />
        <h2>选择一件事，安静地开始</h2>
        <p>专注时会收起导航噪音，同时保留下一次护眼休息提示。</p>
        <div className="focus-candidates">
          {candidates.slice(0, 5).map((task) => <FocusCandidate key={task.id} task={task} onStartFocus={onStartFocus} />)}
        </div>
        {candidates.length === 0 ? <p className="focus-no-candidates">今天还没有承诺任务。先在“今天”添加或规划一件事。</p> : null}
      </section>
    );
  }

  const subtasks = tasks.filter((task) => task.parentId === activeTask.id && task.status !== 'archived');
  const startError = pause.error?.message ?? finish.error?.message;

  // Active task without a live session (e.g. set from elsewhere): offer to
  // start the logical session that tracks 本次/今日/累计 time.
  if (!session || session.taskId !== activeTask.id) {
    return (
      <section className={`${styles.root} focus-surface`}>
        <span className="focus-eyebrow">{activeTask.projectId ? '当前项目任务' : '当前任务'}</span>
        <button type="button" className="focus-title" onClick={() => onOpen(activeTask.id)}>{activeTask.title}</button>
        <span className="focus-progress">开始一段专注会话，记录本次与今日的实际投入。</span>
        {focus.latestCheckpoint ? (
          <div className="focus-resume-context">
            {focus.latestCheckpoint.progress ? <span>上次做到：{focus.latestCheckpoint.progress}</span> : null}
            {focus.latestCheckpoint.nextStep ? <strong>回来先做：{focus.latestCheckpoint.nextStep}</strong> : null}
            {focus.latestCheckpoint.feeling ? <small>当时感受：{focus.latestCheckpoint.feeling}</small> : null}
          </div>
        ) : null}
        <div className="focus-break-hint"><Eye size={17} />下一次护眼 {formatMinutes(eyeRemaining)}</div>
        {subtasks.length ? <div className="focus-subtasks" aria-label="当前任务的步骤">{subtasks.map((task) => <FocusSubtask key={task.id} task={task} />)}</div> : null}
        <div className="focus-actions">
          <Button variant="primary" onClick={() => onStartFocus(activeTask.id)}><Play size={16} />开始专注</Button>
        </div>
        <span className="focus-footer">EyeProtect · 安静工作中</span>
      </section>
    );
  }

  // Live session (USERPLAN §十四): 本次 / 今日 / 累计 / 计划 four layers.
  const sessionMs = session.activeMs + (session.onBreak ? 0 : liveSegmentMs);
  const todayMs = focus.todayTaskMs + (session.onBreak ? 0 : liveSegmentMs);
  const commitPause = (checkpoint: TaskCheckpointDraft | null): void => {
    void pause.run(checkpoint).then((result) => {
      if (!result.ok) return;
      setPauseOpen(false);
      setPauseProgress('');
      setPauseNextStep('');
      setPauseFeeling('');
    });
  };

  return (
    <>
    <section className={`${styles.root} focus-surface`}>
      {immersive ? <button type="button" className="focus-back" onClick={onBack}><ArrowLeft size={15} />返回工作台 <kbd>Esc</kbd></button> : null}
      <span className="focus-eyebrow">{session.onBreak ? '健康休息中' : activeTask.projectId ? '当前项目任务' : '当前任务'}</span>
      <button type="button" className="focus-title" onClick={() => onOpen(activeTask.id)}>{activeTask.title}</button>
      <strong className="focus-timer">{formatClock(sessionMs)}</strong>
      <span className="focus-progress">
        今日实际 {formatMinutes(todayMs)}
        {focus.plannedMinutes !== null ? ` / ${focus.plannedMinutes}m` : ''}
        {' · '}任务累计 {formatMinutes(focus.totalTaskMs)}
      </span>
      {focus.block ? (
        <span className="focus-block-range">
          当前计划块{' '}
          {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(focus.block.startAt))}
          –
          {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(focus.block.endAt))}
        </span>
      ) : null}
      {session.onBreak ? (
        <div className="focus-break-hint focus-on-break"><Coffee size={17} />休息中 · 本次会话 {formatClock(session.activeMs)} 已保留，回来后继续</div>
      ) : (
        <div className="focus-break-hint"><Eye size={17} />下一次护眼 {formatMinutes(eyeRemaining)}</div>
      )}
      {subtasks.length ? <div className="focus-subtasks" aria-label="当前任务的步骤">{subtasks.map((task) => <FocusSubtask key={task.id} task={task} />)}</div> : null}
      {session.onBreak ? (
        <span className="focus-footer">请在休息提醒中完成或跳过休息</span>
      ) : (
        <div className="focus-actions">
          <Button variant="secondary" onClick={() => setPauseOpen(true)}><Pause size={16} />暂停专注</Button>
          <CommandButton
            variant="primary"
            state={finish.state}
            errorReason={finish.error?.message}
            onClick={() => void finish.run(activeTask.id)}
          ><CheckCircle2 size={16} />完成任务</CommandButton>
        </div>
      )}
      <span className="focus-footer">EyeProtect · 安静工作中</span>
    </section>
    <Dialog
      open={pauseOpen}
      title="离开前记一下"
      description={`「${activeTask.title}」会保持为当前任务，稍后可以一键继续。`}
      onClose={() => { if (!pause.isPending) setPauseOpen(false); }}
      footer={<>
        <Button disabled={pause.isPending} onClick={() => commitPause(null)}>直接暂停</Button>
        <CommandButton variant="primary" state={pause.state} errorReason={pause.error?.message} onClick={() => commitPause({ progress: pauseProgress, nextStep: pauseNextStep, feeling: pauseFeeling })}>记录并暂停</CommandButton>
      </>}
    >
      <Field label="做到哪里？"><textarea rows={2} value={pauseProgress} onChange={(event) => setPauseProgress(event.currentTarget.value)} /></Field>
      <Field label="回来先做什么？"><textarea rows={2} value={pauseNextStep} onChange={(event) => setPauseNextStep(event.currentTarget.value)} /></Field>
      <Field label="此刻感受？"><input value={pauseFeeling} onChange={(event) => setPauseFeeling(event.currentTarget.value)} /></Field>
    </Dialog>
    </>
  );
}
