import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { PROJECT_NAME_MAX, type Project, type ProjectInput, type Task } from '../../../../shared/types';
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const rename = useCommand((name: string) => commands.projects.update(project.id, { name }));
  const remove = useCommand(() => commands.projects.remove(project.id));

  useEffect(() => {
    if (isRenaming) setRenameText(project.name);
  }, [isRenaming, project.name]);

  const commitRename = (): void => {
    const name = renameText.trim();
    if (name && name !== project.name) void rename.run(name);
    setIsRenaming(false);
  };

  const closeConfirm = useCallback(() => {
    if (remove.isPending) return;
    setConfirmDeleteOpen(false);
    remove.reset();
  }, [remove.isPending, remove.reset]);

  return (
    <li className={`project-item ${isActive ? 'is-active' : ''}`.trim()} onClick={() => onSelect(project.id)}>
      <ProjectDot color={project.color} className="project-item-dot" />
      {isRenaming ? (
        <input
          className="project-rename-input"
          autoFocus
          value={renameText}
          maxLength={PROJECT_NAME_MAX}
          aria-invalid={rename.error ? true : undefined}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setRenameText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') setIsRenaming(false);
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
          onDoubleClick={(event) => { event.stopPropagation(); setIsRenaming(true); }}
        >{project.name}</button>
      )}
      <span className="project-item-count">{count}</span>
      <CommandButton className="project-item-remove" state={remove.state} errorReason={remove.error?.message} aria-label={`删除项目「${project.name}」`} onClick={(event) => { event.stopPropagation(); setConfirmDeleteOpen(true); }}><Trash2 size={14} /></CommandButton>
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

export function ProjectList({ projects, tasks, selectedProjectId, onSelect }: {
  projects: Project[];
  tasks: Task[];
  selectedProjectId: string | null;
  onSelect: (id: string | null) => void;
}): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
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
    setDialogOpen(false);
    setNewName('');
    create.reset();
  }, [create.isPending, create.reset]);

  const commitAdd = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    void create.run({ name, color }).then((result) => {
      if (!result.ok) return;
      const created = [...result.data].sort((a, b) => b.createdAt - a.createdAt)[0];
      setDialogOpen(false);
      setNewName('');
      create.reset();
      if (created) onSelect(created.id);
    });
  }, [newName, color, create.run, create.reset, onSelect]);

  return (
    <div className="project-list">
      <div className="project-list-header"><span className="project-list-title"><FolderOpen size={15} />项目</span><IconButton className="project-add" aria-label="新建项目" title="新建项目" onClick={() => setDialogOpen(true)}><Plus size={16} /></IconButton></div>
      <ul className="project-list-items">
        {projects.length === 0 ? <li className="project-empty">还没有项目</li> : projects.map((project) => <ProjectItem key={project.id} project={project} count={taskCountByProject.get(project.id) ?? 0} isActive={selectedProjectId === project.id} onSelect={(id) => onSelect(selectedProjectId === id ? null : id)} />)}
      </ul>
      <Dialog
        open={dialogOpen}
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
