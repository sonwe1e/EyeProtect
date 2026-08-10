import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_NAME_MAX,
  type Project,
  type ProjectInput,
  type Task
} from '../../../../shared/types';
import { CommandButton } from '../../components/CommandButton';
import { useCommand } from '../../hooks/useCommand';
import { commands } from '../../lib/commands';

/** One project row. Fully owns its rename draft, rename command, and delete
 *  command, so a failure on one row can never bleed onto a sibling row. */
function ProjectItem({
  project,
  count,
  isActive,
  onSelect
}: {
  project: Project;
  count: number;
  isActive: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameText, setRenameText] = useState(project.name);
  const rename = useCommand((name: string) => commands.projects.update(project.id, { name }));
  const remove = useCommand(() => commands.projects.remove(project.id));

  // Re-initialize the draft whenever this row (re)enters rename mode.
  useEffect(() => {
    if (isRenaming) {
      setRenameText(project.name);
    }
  }, [isRenaming, project.name]);

  const startRename = (): void => {
    setIsRenaming(true);
  };

  const commitRename = (): void => {
    const name = renameText.trim();
    if (name && name !== project.name) {
      void rename.run(name);
    }
    setIsRenaming(false);
  };

  return (
    <li
      className={`project-item ${isActive ? 'is-active' : ''}`.trim()}
      style={{ ['--chip-color' as string]: project.color ?? '#8aa0a6' }}
      onClick={() => onSelect(project.id)}
    >
      <span className="project-item-dot" />
      {isRenaming ? (
        <input
          className="project-rename-input"
          type="text"
          autoFocus
          value={renameText}
          maxLength={PROJECT_NAME_MAX}
          aria-invalid={rename.error ? true : undefined}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setRenameText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRename();
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              setRenameText(project.name);
              setIsRenaming(false);
            }
          }}
          onBlur={commitRename}
        />
      ) : (
        <span
          className="project-item-name"
          title={`${project.name}（双击重命名）`}
          onDoubleClick={(event) => {
            event.stopPropagation();
            startRename();
          }}
        >
          {project.name}
        </span>
      )}
      <span className="project-item-count">{count}</span>
      <CommandButton
        type="button"
        className="project-item-remove"
        state={remove.state}
        errorReason={remove.error?.message}
        title="删除项目"
        aria-label={`删除项目「${project.name}」`}
        onClick={(event) => {
          event.stopPropagation();
          void remove.run();
        }}
      >
        <Trash2 size={12} />
      </CommandButton>
    </li>
  );
}

/** Sidebar project list: each item filters the center column to that project.
 *  All mutations (add/rename/delete) run through the command layer so a failure
 *  is shown on the control instead of being silently dropped. */
export function ProjectList({
  projects,
  tasks,
  selectedProjectId,
  onSelect
}: {
  projects: Project[];
  tasks: Task[];
  selectedProjectId: string | null;
  onSelect: (id: string | null) => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  const create = useCommand((input: ProjectInput) => commands.projects.create(input));

  const taskCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.projectId && task.status === 'open') {
        counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
      }
    }
    return counts;
  }, [tasks]);

  useEffect(() => {
    if (adding) {
      addInputRef.current?.focus();
    }
  }, [adding]);

  const cancelAdd = useCallback(() => {
    setAdding(false);
    setNewName('');
  }, []);

  const commitAdd = useCallback(() => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    const used = new Set(projects.map((project) => project.color).filter(Boolean));
    const palette = ['#217a70', '#e67e22', '#c0392b', '#3498db', '#8e44ad', '#16a085'];
    const color = palette.find((entry) => !used.has(entry)) ?? palette[0];
    void create.run({ name, color }).then((result) => {
      // Only close + clear on success. On failure (e.g. read-only database) the
      // input stays open with the name preserved so the user can retry.
      if (result.ok) {
        setNewName('');
        setAdding(false);
      }
    });
  }, [newName, projects, create]);

  return (
    <div className="project-list">
      <div className="project-list-header">
        <span className="project-list-title">
          <FolderOpen size={13} />
          项目
        </span>
        <CommandButton
          type="button"
          className="project-add"
          title="新建项目"
          aria-label="新建项目"
          onClick={() => setAdding((value) => !value)}
        >
          <Plus size={13} />
        </CommandButton>
      </div>
      {adding ? (
        <div className="project-add-row">
          <input
            ref={addInputRef}
            type="text"
            placeholder="项目名称"
            value={newName}
            maxLength={PROJECT_NAME_MAX}
            onChange={(event) => setNewName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitAdd();
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                cancelAdd();
              }
            }}
            onBlur={commitAdd}
          />
        </div>
      ) : null}
      <ul className="project-list-items">
        {projects.length === 0 ? (
          <li className="project-empty">还没有项目。</li>
        ) : (
          projects.map((project) => {
            const count = taskCountByProject.get(project.id) ?? 0;
            return (
              <ProjectItem
                key={project.id}
                project={project}
                count={count}
                isActive={selectedProjectId === project.id}
                onSelect={(id) => onSelect(selectedProjectId === id ? null : id)}
              />
            );
          })
        )}
      </ul>
    </div>
  );
}
