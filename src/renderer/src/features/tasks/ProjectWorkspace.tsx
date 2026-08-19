import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Columns3, List, Play, Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_GOAL_MAX,
  SECTION_TEMPLATE,
  type Project,
  type ProjectSection,
  type Task,
  type TimeBlock
} from '../../../../shared/types';
import { isProjectAssignable, isProjectWritable } from '../../../../shared/projectPolicy';
import { groupTasksBySection } from '../../../../shared/projectSections';
import { CommandButton } from '../../components/CommandButton';
import { Button, Dialog, ProjectDot, StatusChip } from '../../components/primitives';
import { useCommand } from '../../hooks/useCommand';
import { useProjectSections } from '../../hooks/useProjectSections';
import { commands } from '../../lib/commands';
import { TaskComposer } from './TaskComposer';
import { TaskList } from './TaskList';
import styles from './ProjectWorkspace.module.css';

function BoardCard({ task, active, writable, onOpen }: { task: Task; active: boolean; writable: boolean; onOpen: () => void }): JSX.Element {
  const focus = useCommand(() => commands.focus.start(task.id));
  const complete = useCommand((status: Task['status']) => commands.tasks.setStatus(task.id, status));

  return (
    <article
      className="project-board-card"
      draggable={writable}
      onDragStart={(event) => {
        if (!writable) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-eyeprotect-task', task.id);
      }}
    >
      <button type="button" className="project-board-card__title" onClick={onOpen}>{task.title}</button>
      <div className="project-board-card__meta">
        {active ? <StatusChip tone="brand">● 当前任务</StatusChip> : null}
        {task.estimateMinutes ? <span>{task.estimateMinutes}m</span> : <span>未估时</span>}
        {task.priority !== 'normal' ? <StatusChip tone={task.priority === 'urgent' ? 'danger' : 'warning'}>{task.priority === 'urgent' ? '紧急' : '重要'}</StatusChip> : null}
      </div>
      {writable ? (
        <div className="project-board-card__actions">
          <CommandButton variant="ghost" state={focus.state} errorReason={focus.error?.message} onClick={() => void focus.run()}><Play size={14} />开始专注</CommandButton>
          <CommandButton variant="ghost" state={complete.state} errorReason={complete.error?.message} onClick={() => void complete.run('done')}><CheckCircle2 size={14} />完成</CommandButton>
        </div>
      ) : null}
    </article>
  );
}

/** Column header: rename on double-click, reorder with arrows, delete guarded. */
function SectionHeader({ section, count, canMoveLeft, canMoveRight, moveLeftBeforeId, moveRightBeforeId, onRenamed, onDeleted }: {
  section: ProjectSection;
  count: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  moveLeftBeforeId: string | null;
  moveRightBeforeId: string | null;
  onRenamed: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const [validationError, setValidationError] = useState<string | null>(null);
  const cancelRenameRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rename = useCommand((name: string) => commands.sections.rename(section.id, name));
  const move = useCommand((beforeSectionId: string | null) => commands.sections.move(section.id, beforeSectionId));
  const remove = useCommand(() => commands.sections.remove(section.id));

  useEffect(() => {
    if (editing) setDraft(section.name);
  }, [editing, section.name]);

  const commitRename = (): void => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    if (rename.isPending) return;
    const name = draft.trim();
    if (!name) {
      setValidationError('分组名称不能为空');
      return;
    }
    if (name === section.name) {
      setEditing(false);
      return;
    }
    void rename.run(name).then((result) => {
      if (result.ok) {
        setValidationError(null);
        setEditing(false);
        onRenamed();
      }
    });
  };

  const commitMove = (beforeSectionId: string | null): void => {
    void move.run(beforeSectionId).then((result) => { if (result.ok) onRenamed(); });
  };

  return (
    <header className="project-section-header">
      {editing ? (
        <input
          className="project-section-rename"
          autoFocus
          value={draft}
          disabled={rename.isPending}
          aria-invalid={rename.error || validationError ? true : undefined}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => { setDraft(event.currentTarget.value); setValidationError(null); rename.reset(); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') { cancelRenameRef.current = true; setValidationError(null); rename.reset(); setEditing(false); }
          }}
          onBlur={commitRename}
        />
      ) : (
        <h2>
          <button type="button" className="project-section-name" title={`${section.name}（点击重命名）`} onClick={() => { cancelRenameRef.current = false; setEditing(true); }}>
            {section.name}
          </button>
        </h2>
      )}
      <span className="project-section-tools">
        <span className="project-section-count">{count}</span>
        <button type="button" aria-label={`「${section.name}」左移`} disabled={!canMoveLeft || move.isPending} onClick={() => commitMove(moveLeftBeforeId)}><ChevronLeft size={13} /></button>
        <button type="button" aria-label={`「${section.name}」右移`} disabled={!canMoveRight || move.isPending} onClick={() => commitMove(moveRightBeforeId)}><ChevronRight size={13} /></button>
        <button type="button" aria-label={`删除分组「${section.name}」`} onClick={() => setConfirmOpen(true)}><Trash2 size={13} /></button>
      </span>
      {editing && (validationError || rename.error) ? <small className="project-section-error" role="alert">{validationError ?? rename.error?.message}</small> : null}
      {move.error ? <small className="project-section-error" role="alert">{move.error.message}</small> : null}
      <Dialog
        open={confirmOpen}
        title={`删除分组「${section.name}」`}
        description="分组内的任务会保留，并移回未分组。"
        onClose={() => { if (!remove.isPending) setConfirmOpen(false); }}
        footer={<><Button onClick={() => setConfirmOpen(false)}>取消</Button><CommandButton variant="danger" state={remove.state} errorReason={remove.error?.message} onClick={() => void remove.run().then((result) => { if (result.ok) { setConfirmOpen(false); onDeleted(); } })}>确认删除</CommandButton></>}
      >
        <p>{count > 0 ? `${count} 个任务将移回未分组，不会被删除。` : '该分组目前是空的。'}</p>
      </Dialog>
    </header>
  );
}

export function ProjectWorkspace({
  project,
  tasks,
  projects,
  timeBlocks,
  activeTaskId,
  now,
  selectedTaskId,
  onSelectTask
}: {
  project: Project;
  tasks: Task[];
  projects: Project[];
  timeBlocks: TimeBlock[];
  activeTaskId: string | null;
  now: number;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}): JSX.Element {
  const [goalDraft, setGoalDraft] = useState(project.goal ?? '');
  const [goalEditing, setGoalEditing] = useState(false);
  const cancelGoalRef = useRef(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [sectionCreatorOpen, setSectionCreatorOpen] = useState(false);
  const { sections, refresh } = useProjectSections(project.id);
  const updateProject = useCommand((input: Parameters<typeof commands.projects.update>[1]) => commands.projects.update(project.id, input));
  const moveTask = useCommand((input: Parameters<typeof commands.tasks.move>[0]) => commands.tasks.move(input));
  const setTaskSection = useCommand((taskId: string, sectionId: string | null) => commands.tasks.setSection(taskId, sectionId));
  const createSection = useCommand((name: string) => commands.sections.create({ projectId: project.id, name }));

  useEffect(() => setGoalDraft(project.goal ?? ''), [project.id, project.goal]);
  useEffect(() => {
    setNewSectionName('');
    setSectionCreatorOpen(false);
    setGoalEditing(false);
  }, [project.id]);

  const writable = isProjectWritable(project);
  const assignable = isProjectAssignable(project);
  const projectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === project.id && task.status !== 'archived'),
    [tasks, project.id]
  );
  const openTasks = useMemo(() => projectTasks.filter((task) => task.status === 'open'), [projectTasks]);
  const done = projectTasks.filter((task) => task.status === 'done');
  // Board columns / list groups come from sections — never from the global
  // active task (ADR-002). Focus only renders a badge on its card.
  const groups = useMemo(() => groupTasksBySection(openTasks, sections), [openTasks, sections]);

  const saveGoal = (): void => {
    const goal = goalDraft.trim();
    if (goal !== (project.goal ?? '')) void updateProject.run({ goal: goal || null });
  };

  const addSection = (name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void createSection.run(trimmed).then((result) => {
      if (result.ok) {
        setNewSectionName('');
        setSectionCreatorOpen(false);
        refresh();
      }
    });
  };

  const addTemplate = async (): Promise<void> => {
    for (const name of SECTION_TEMPLATE) {
      const result = await createSection.run(name);
      if (!result.ok) return;
    }
    setSectionCreatorOpen(false);
    refresh();
  };

  return (
    <div className={`workspace-page project-page ${styles.root}`}>
      <header className="project-page-header">
        <div className="project-heading">
          <ProjectDot color={project.color} />
          <div>
            <span className="page-eyebrow">项目</span><h1>{project.name}</h1>
            {goalEditing && writable ? (
              <input
                className="project-goal-input"
                autoFocus
                value={goalDraft}
                maxLength={PROJECT_GOAL_MAX}
                aria-label="项目目标"
                placeholder="这个项目完成时，什么会变得不同？"
                onChange={(event) => setGoalDraft(event.currentTarget.value)}
                onBlur={() => {
                  if (cancelGoalRef.current) {
                    cancelGoalRef.current = false;
                    setGoalDraft(project.goal ?? '');
                  } else {
                    saveGoal();
                  }
                  setGoalEditing(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    cancelGoalRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <button type="button" className="project-goal-text" onClick={() => writable && setGoalEditing(true)} disabled={!writable}>
                {project.goal || '添加项目目标'}
              </button>
            )}
          </div>
        </div>
        <div className="project-view-switch" aria-label="项目视图">
          <Button
            variant="ghost"
            className={project.viewMode === 'list' ? 'is-active' : ''}
            disabled={updateProject.isPending || !writable}
            aria-pressed={project.viewMode === 'list'}
            onClick={() => void updateProject.run({ viewMode: 'list' })}
          ><List size={16} />列表</Button>
          <Button
            variant="ghost"
            className={project.viewMode === 'board' ? 'is-active' : ''}
            disabled={updateProject.isPending || !writable}
            aria-pressed={project.viewMode === 'board'}
            onClick={() => void updateProject.run({ viewMode: 'board' })}
          ><Columns3 size={16} />看板</Button>
        </div>
      </header>
      {updateProject.error ? <p className="project-page-error" role="alert">{updateProject.error.message}</p> : null}
      {!writable ? (
        <p className="project-lifecycle-banner" role="note">
          {project.status === 'completed' ? '此项目已标记完成，进入只读历史状态。' : '此项目已归档，进入只读历史状态。'}
        </p>
      ) : !assignable ? (
        <p className="project-lifecycle-banner" role="note">此项目已暂存，保留原有任务和日程，但不再接受新任务或新的规划。</p>
      ) : null}
      <div className="project-progress-summary"><StatusChip tone="brand">{openTasks.length} 进行中 · {done.length} 已完成</StatusChip></div>
      {assignable ? (
        <TaskComposer projects={projects} tasks={tasks} placement={{ type: 'project', projectId: project.id }} />
      ) : null}

      {writable ? (
        <div className="project-section-bar">
          {sectionCreatorOpen ? (
            <>
              <input
                className="project-section-input"
                autoFocus
                value={newSectionName}
                placeholder="新分组名称…"
                onChange={(event) => setNewSectionName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSection(newSectionName);
                  } else if (event.key === 'Escape') {
                    setNewSectionName('');
                    setSectionCreatorOpen(false);
                  }
                }}
              />
              <Button disabled={createSection.isPending || !newSectionName.trim()} onClick={() => addSection(newSectionName)}><Plus size={14} />添加分组</Button>
              <Button variant="ghost" disabled={createSection.isPending} onClick={() => { setNewSectionName(''); setSectionCreatorOpen(false); }}>取消</Button>
              {sections.length === 0 ? (
                <Button variant="ghost" disabled={createSection.isPending} onClick={() => void addTemplate()}>
                  使用模板（{SECTION_TEMPLATE.join(' / ')}）
                </Button>
              ) : null}
            </>
          ) : (
            <Button variant="ghost" onClick={() => setSectionCreatorOpen(true)}><Plus size={14} />分组</Button>
          )}
          {createSection.error ? <span className="project-page-error" role="alert">{createSection.error.message}</span> : null}
        </div>
      ) : null}

      {project.viewMode === 'list' ? (
        <>
          {groups.map((group) => (
            <section className="task-section" key={group.sectionId ?? 'none'}>
              <h2>{group.title}</h2>
              {group.tasks.length === 0 ? <p className="project-empty-hint">暂无任务</p> : (
                <TaskList
                  tasks={group.tasks}
                  view="inbox"
                  projects={projects}
                  now={now}
                  selectedTaskId={selectedTaskId}
                  scopeProjectId={project.id}
                  timeBlocks={timeBlocks}
                  onMovePending={moveTask.isPending}
                  onSelect={onSelectTask}
                  onMove={(taskId, beforeTaskId) => void moveTask.run({ taskId, beforeTaskId, scope: { type: 'project', projectId: project.id } })}
                />
              )}
            </section>
          ))}
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
                timeBlocks={timeBlocks}
                onSelect={onSelectTask}
              />
            </details>
          ) : null}
        </>
      ) : (
        <div className="project-board">
          {groups.map((group) => {
            const section = group.sectionId ? sections.find((entry) => entry.id === group.sectionId) : undefined;
            const sectionIndex = section ? sections.indexOf(section) : -1;
            return (
              <section
                key={group.sectionId ?? 'none'}
                className="project-board-column"
                onDragOver={writable ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } : undefined}
                onDrop={writable ? (event) => {
                  event.preventDefault();
                  const taskId = event.dataTransfer.getData('application/x-eyeprotect-task');
                  if (!taskId) return;
                  const target = tasks.find((entry) => entry.id === taskId);
                  if (!target || target.sectionId === group.sectionId) return;
                  void setTaskSection.run(taskId, group.sectionId);
                } : undefined}
              >
                {section ? (
                  <SectionHeader
                    section={section}
                    count={group.tasks.length}
                    canMoveLeft={sectionIndex > 0}
                    canMoveRight={sectionIndex < sections.length - 1}
                    moveLeftBeforeId={sections[sectionIndex - 1]?.id ?? null}
                    moveRightBeforeId={sections[sectionIndex + 2]?.id ?? null}
                    onRenamed={refresh}
                    onDeleted={refresh}
                  />
                ) : (
                  <header className="project-section-header"><h2>{group.title}</h2><span className="project-section-tools"><span className="project-section-count">{group.tasks.length}</span></span></header>
                )}
                <div>{group.tasks.map((task) => <BoardCard key={task.id} task={task} active={task.id === activeTaskId} writable={writable} onOpen={() => onSelectTask(task.id)} />)}</div>
                {group.tasks.length === 0 ? <p className="project-empty-hint">拖拽任务到这里</p> : null}
              </section>
            );
          })}
        </div>
      )}
      {done.length && project.viewMode === 'board' ? (
        <details className="project-completed">
          <summary>已完成 · {done.length}</summary>
          <TaskList
            tasks={done}
            view="completed"
            projects={projects}
            now={now}
            selectedTaskId={selectedTaskId}
            scopeProjectId={project.id}
            timeBlocks={timeBlocks}
            onSelect={onSelectTask}
          />
        </details>
      ) : null}
      {setTaskSection.error ? <p className="project-page-error" role="alert">{setTaskSection.error.message}</p> : null}
    </div>
  );
}
