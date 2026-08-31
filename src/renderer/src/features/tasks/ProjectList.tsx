import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, CirclePause, FolderOpen, Inbox, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { PROJECT_NAME_MAX, type Project, type ProjectInput, type ProjectStatus, type Task } from '../../../../shared/types';
import { CommandButton } from '../../components/CommandButton';
import { Button, Dialog, Field, IconButton, ProjectDot, TextField } from '../../components/primitives';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';

const PROJECT_COLORS = ['#2e6f61', '#4e6f91', '#7b628f', '#9a6a35', '#6d7a43'];

function ProjectItem({ project, count, isActive, onSelect }: {
  project: Project;
  count: number;
  isActive: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameText, setRenameText] = useState(project.name);
  const [renameValidation, setRenameValidation] = useState<string | null>(null);
  const cancelRenameRef = useRef(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rename = useCommand((name: string) => commands.projects.update(project.id, { name }));
  const lifecycle = useCommand((status: ProjectStatus) => commands.projects.update(project.id, { status }));
  const remove = useCommand(() => commands.projects.remove(project.id));

  useEffect(() => {
    if (isRenaming) setRenameText(project.name);
  }, [isRenaming, project.name]);

  const commitRename = (): void => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    if (rename.isPending) return;
    const name = renameText.trim();
    if (!name) {
      setRenameValidation('项目名称不能为空');
      return;
    }
    if (name === project.name) {
      setIsRenaming(false);
      return;
    }
    void rename.run(name).then((result) => {
      if (result.ok) {
        setRenameValidation(null);
        setIsRenaming(false);
      }
    });
  };

  const closeConfirm = useCallback(() => {
    if (remove.isPending) return;
    setConfirmDeleteOpen(false);
    remove.reset();
  }, [remove.isPending, remove.reset]);
  const changeStatus = (status: ProjectStatus): void => {
    void lifecycle.run(status).then((result) => {
      if (result.ok) setMenuOpen(false);
    });
  };

  return (
    <li className={`project-item status-${project.status} ${isActive ? 'is-active' : ''}`.trim()} onClick={() => onSelect(project.id)}>
      <ProjectDot color={project.color} className="project-item-dot" />
      {isRenaming ? (
        <input
          className="project-rename-input"
          autoFocus
          value={renameText}
          maxLength={PROJECT_NAME_MAX}
          aria-invalid={rename.error || renameValidation ? true : undefined}
          onClick={(event) => event.stopPropagation()}
          disabled={rename.isPending}
          onChange={(event) => { setRenameText(event.currentTarget.value); setRenameValidation(null); rename.reset(); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') { cancelRenameRef.current = true; setRenameValidation(null); rename.reset(); setIsRenaming(false); }
          }}
          onBlur={commitRename}
        />
      ) : (
        <button
          type="button"
          className="project-item-name"
          title={`${project.name}（双击重命名）`}
          aria-current={isActive ? 'page' : undefined}
          onClick={(event) => { event.stopPropagation(); onSelect(project.id); }}
          onDoubleClick={(event) => { event.stopPropagation(); cancelRenameRef.current = false; setIsRenaming(true); }}
        >{project.name}</button>
      )}
      {isRenaming && (renameValidation || rename.error) ? <small className="project-rename-error" role="alert">{renameValidation ?? rename.error?.message}</small> : null}
      <span className="project-item-count">{count}</span>
      <button type="button" className="project-item-menu-trigger" aria-label={`管理项目「${project.name}」`} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}><MoreHorizontal size={15} /></button>
      {menuOpen ? (
        <div className="project-item-menu" role="menu" onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setIsRenaming(true); }}><Pencil size={14} />重命名</button>
          {project.status !== 'active' ? <button type="button" role="menuitem" onClick={() => changeStatus('active')}><RotateCcw size={14} />恢复进行</button> : null}
          {project.status !== 'onHold' ? <button type="button" role="menuitem" onClick={() => changeStatus('onHold')}><CirclePause size={14} />暂存</button> : null}
          {project.status !== 'completed' ? <button type="button" role="menuitem" onClick={() => changeStatus('completed')}><CheckCircle2 size={14} />标记完成</button> : null}
          {project.status !== 'archived' ? <button type="button" role="menuitem" onClick={() => changeStatus('archived')}><Archive size={14} />归档</button> : null}
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); setConfirmDeleteOpen(true); }}><Trash2 size={14} />删除</button>
          {lifecycle.error ? <small role="alert">{lifecycle.error.message}</small> : null}
        </div>
      ) : null}
      <Dialog
        open={confirmDeleteOpen}
        title={`删除项目「${project.name}」`}
        description="删除是不可撤销的破坏性操作。"
        onClose={closeConfirm}
        footer={<><Button onClick={closeConfirm}>取消</Button><CommandButton variant="danger" state={remove.state} errorReason={remove.error?.message} disabled={remove.isPending} onClick={() => void remove.run().then((result) => { if (result.ok) setConfirmDeleteOpen(false); })}>确认删除</CommandButton></>}
      >
        <p className="project-delete-warning">
          {count > 0
            ? `项目下还有 ${count} 个未完成任务。删除项目后这些任务会保留，但会失去项目分组。`
            : '删除后项目分组将立即消失，此操作无法撤销。'}
        </p>
      </Dialog>
    </li>
  );
}

export function ProjectList({ projects, tasks, selectedProjectId, onSelect, unclassifiedSelected, onSelectUnclassified, createOpen, onCreateOpenChange }: {
  projects: Project[];
  tasks: Task[];
  selectedProjectId: string | null;
  onSelect: (id: string | null) => void;
  unclassifiedSelected: boolean;
  onSelectUnclassified: () => void;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [newName, setNewName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const create = useCommand((input: ProjectInput) => commands.projects.create(input));
  const taskCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.projectId && task.status === 'open') counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  const closeDialog = useCallback(() => {
    if (create.isPending) return;
    onCreateOpenChange(false);
    setNewName('');
    create.reset();
  }, [create.isPending, create.reset, onCreateOpenChange]);

  const commitAdd = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    void create.run({ name, color }).then((result) => {
      if (!result.ok) return;
      const created = [...result.data].sort((a, b) => b.createdAt - a.createdAt)[0];
      onCreateOpenChange(false);
      setNewName('');
      create.reset();
      if (created) onSelect(created.id);
    });
  }, [newName, color, create.run, create.reset, onSelect, onCreateOpenChange]);

  const orderedProjects = useMemo(() => [
    ...projects.filter((project) => project.status === 'active'),
    ...projects.filter((project) => project.status === 'onHold'),
    ...projects.filter((project) => project.status === 'completed'),
    ...projects.filter((project) => project.status === 'archived')
  ], [projects]);
  const unclassifiedCount = tasks.filter((task) => task.status === 'open' && task.projectId === null).length;

  return (
    <div className="project-list">
      <div className="project-list-header"><span className="project-list-title"><FolderOpen size={15} />项目</span><IconButton className="project-add" aria-label="新建项目" title="新建项目" onClick={() => onCreateOpenChange(true)}><Plus size={16} /></IconButton></div>
      <ul className="project-list-items">
        <li className={`project-item project-unclassified ${unclassifiedSelected ? 'is-active' : ''}`.trim()}>
          <Inbox size={14} />
          <button type="button" className="project-item-name" aria-current={unclassifiedSelected ? 'page' : undefined} onClick={onSelectUnclassified}>未归类</button>
          <span className="project-item-count">{unclassifiedCount}</span>
        </li>
        {projects.length === 0 ? <li className="project-empty">还没有项目</li> : orderedProjects.map((project, index) => {
          const previous = orderedProjects[index - 1];
          const showGroup = project.status !== 'active' && (index === 0 || previous?.status !== project.status);
          const groupLabel = project.status === 'onHold' ? '已暂存' : project.status === 'completed' ? '已完成' : project.status === 'archived' ? '已归档' : '';
          return <Fragment key={project.id}>{showGroup && groupLabel ? <li className="project-group-label">{groupLabel}</li> : null}<ProjectItem project={project} count={taskCountByProject.get(project.id) ?? 0} isActive={selectedProjectId === project.id} onSelect={onSelect} /></Fragment>;
        })}
      </ul>
      <Dialog
        open={createOpen}
        title="新建项目"
        description="用项目聚合一个清晰目标下的任务。"
        onClose={closeDialog}
        footer={<><Button onClick={closeDialog}>取消</Button><CommandButton variant="primary" state={create.state} errorReason={create.error?.message} disabled={!newName.trim()} onClick={commitAdd}>创建项目</CommandButton></>}
      >
        <Field label="名称" error={create.error?.message}><TextField value={newName} maxLength={PROJECT_NAME_MAX} placeholder="例如：Research" aria-invalid={create.error ? true : undefined} onChange={(event) => setNewName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitAdd(); } }} /></Field>
        <fieldset className="project-color-field"><legend>颜色</legend><div>{PROJECT_COLORS.map((entry) => <button key={entry} type="button" className={color === entry ? 'is-selected' : ''} style={{ ['--project-color' as string]: entry }} aria-label={`选择颜色 ${entry}`} aria-pressed={color === entry} onClick={() => setColor(entry)} />)}</div></fieldset>
      </Dialog>
    </div>
  );
}
