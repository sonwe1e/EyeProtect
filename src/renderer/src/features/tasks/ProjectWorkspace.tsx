import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Columns3, List, Play } from 'lucide-react';
import {
  PROJECT_GOAL_MAX,
  type Project,
  type Task
} from '../../../../shared/types';
import { CommandButton } from '../../components/CommandButton';
import { Button, ProjectDot, StatusChip } from '../../components/primitives';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';
import { TaskComposer } from './TaskComposer';
import { TaskList } from './TaskList';
import styles from './ProjectWorkspace.module.css';

function BoardCard({ task, active, onOpen }: { task: Task; active: boolean; onOpen: () => void }): JSX.Element {
  const setActive = useCommand((id: string | null) => commands.tasks.setActive(id));
  const complete = useCommand((status: Task['status']) => commands.tasks.setStatus(task.id, status));

  return (
    <article
      className="project-board-card"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-eyeprotect-task', task.id);
      }}
    >
      <button type="button" className="project-board-card__title" onClick={onOpen}>{task.title}</button>
      <div className="project-board-card__meta">
        {task.estimateMinutes ? <span>{task.estimateMinutes}m</span> : <span>未估时</span>}
        {task.priority !== 'normal' ? <StatusChip tone={task.priority === 'urgent' ? 'danger' : 'warning'}>{task.priority === 'urgent' ? '紧急' : '重要'}</StatusChip> : null}
      </div>
      <div className="project-board-card__actions">
        {task.status === 'done' ? (
          <CommandButton variant="ghost" state={complete.state} errorReason={complete.error?.message} onClick={() => void complete.run('open')}><Circle size={14} />恢复</CommandButton>
        ) : (
          <>
            <CommandButton variant="ghost" state={setActive.state} errorReason={setActive.error?.message} onClick={() => void setActive.run(active ? null : task.id)}><Play size={14} />{active ? '暂停' : '专注'}</CommandButton>
            <CommandButton variant="ghost" state={complete.state} errorReason={complete.error?.message} onClick={() => void complete.run('done')}><CheckCircle2 size={14} />完成</CommandButton>
          </>
        )}
      </div>
    </article>
  );
}

export function ProjectWorkspace({
  project,
  tasks,
  projects,
  activeTaskId,
  now,
  selectedTaskId,
  onSelectTask
}: {
  project: Project;
  tasks: Task[];
  projects: Project[];
  activeTaskId: string | null;
  now: number;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}): JSX.Element {
  const [goalDraft, setGoalDraft] = useState(project.goal ?? '');
  const updateProject = useCommand((input: Parameters<typeof commands.projects.update>[1]) => commands.projects.update(project.id, input));
  const moveTask = useCommand((input: Parameters<typeof commands.tasks.move>[0]) => commands.tasks.move(input));
  const moveBoardTask = useCommand(async (taskId: string, column: 'pending' | 'active' | 'done') => {
    const target = tasks.find((entry) => entry.id === taskId);
    if (!target) return { ok: false as const, code: 'not-found' as const, message: '任务不存在', recoverable: true };
    if (column === 'done') return commands.tasks.setStatus(taskId, 'done');
    if (target.status === 'done') {
      const restored = await commands.tasks.setStatus(taskId, 'open');
      if (!restored.ok) return restored;
    }
    if (column === 'active') return commands.tasks.setActive(taskId);
    if (taskId === activeTaskId) return commands.tasks.setActive(null);
    return commands.tasks.setStatus(taskId, 'open');
  });

  useEffect(() => setGoalDraft(project.goal ?? ''), [project.id, project.goal]);

  const projectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === project.id && task.status !== 'archived'),
    [tasks, project.id]
  );
  const done = projectTasks.filter((task) => task.status === 'done');
  const active = projectTasks.filter((task) => task.status === 'open' && task.id === activeTaskId);
  const pending = projectTasks.filter((task) => task.status === 'open' && task.id !== activeTaskId);
  const progress = projectTasks.length ? Math.round(done.length / projectTasks.length * 100) : 0;

  const saveGoal = (): void => {
    const goal = goalDraft.trim();
    if (goal !== (project.goal ?? '')) void updateProject.run({ goal: goal || null });
  };

  return (
    <div className={`workspace-page project-page ${styles.root}`}>
      <header className="project-page-header">
        <div className="project-heading">
          <ProjectDot color={project.color} />
          <div><span className="page-eyebrow">项目</span><h1>{project.name}</h1></div>
        </div>
        <div className="project-view-switch" aria-label="项目视图">
          <Button
            variant="ghost"
            className={project.viewMode === 'list' ? 'is-active' : ''}
            disabled={updateProject.isPending}
            aria-pressed={project.viewMode === 'list'}
            onClick={() => void updateProject.run({ viewMode: 'list' })}
          ><List size={16} />列表</Button>
          <Button
            variant="ghost"
            className={project.viewMode === 'board' ? 'is-active' : ''}
            disabled={updateProject.isPending}
            aria-pressed={project.viewMode === 'board'}
            onClick={() => void updateProject.run({ viewMode: 'board' })}
          ><Columns3 size={16} />看板</Button>
        </div>
      </header>
      {updateProject.error ? <p className="project-page-error" role="alert">{updateProject.error.message}</p> : null}
      <label className="project-goal-field">
        <span>项目目标</span>
        <input
          value={goalDraft}
          maxLength={PROJECT_GOAL_MAX}
          placeholder="这个项目完成时，什么会变得不同？"
          onChange={(event) => setGoalDraft(event.currentTarget.value)}
          onBlur={saveGoal}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setGoalDraft(project.goal ?? '');
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <div className="project-progress-summary"><div><span style={{ width: `${progress}%` }} /></div><StatusChip tone="brand">{progress}% 完成 · {done.length}/{projectTasks.length}</StatusChip></div>
      <TaskComposer projects={projects} defaultProjectId={project.id} />
      {project.viewMode === 'list' ? (
        <section className="task-section">
          <h2>下一步</h2>
          <TaskList
            tasks={[...active, ...pending]}
            view="inbox"
            projects={projects}
            now={now}
            selectedTaskId={selectedTaskId}
            scopeProjectId={project.id}
            onSelect={onSelectTask}
            onMove={(taskId, beforeTaskId) => void moveTask.run({ taskId, beforeTaskId, scope: { type: 'project', projectId: project.id } })}
          />
          {done.length ? (
            <details className="project-completed">
              <summary>已完成 · {done.length}</summary>
              <TaskList
                tasks={done}
                view="completed"
                projects={projects}
                now={now}
                selectedTaskId={selectedTaskId}
                scopeProjectId={project.id}
                onSelect={onSelectTask}
              />
            </details>
          ) : null}
        </section>
      ) : (
        <div className="project-board">
          {[
            { id: 'pending', title: '待处理', tasks: pending },
            { id: 'active', title: '进行中', tasks: active },
            { id: 'done', title: '已完成', tasks: done }
          ].map((column) => (
            <section
              key={column.id}
              className="project-board-column"
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              onDrop={(event) => {
                event.preventDefault();
                const taskId = event.dataTransfer.getData('application/x-eyeprotect-task');
                if (taskId) void moveBoardTask.run(taskId, column.id as 'pending' | 'active' | 'done');
              }}
            >
              <header><h2>{column.title}</h2><span>{column.tasks.length}</span></header>
              <div>{column.tasks.map((task) => <BoardCard key={task.id} task={task} active={task.id === activeTaskId} onOpen={() => onSelectTask(task.id)} />)}</div>
              {column.tasks.length === 0 ? <p>暂无任务</p> : null}
            </section>
          ))}
        </div>
      )}
      {moveBoardTask.error ? <p className="project-page-error" role="alert">{moveBoardTask.error.message}</p> : null}
    </div>
  );
}
