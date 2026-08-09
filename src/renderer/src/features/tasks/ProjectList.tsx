import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_NAME_MAX,
  type Project,
  type Task
} from '../../../../shared/types';

/** Sidebar project list: each item filters the center column to that project. */
export function ProjectList({
  projects,
  tasks,
  selectedProjectId,
  onSelect,
  onCreate,
  onRename,
  onDelete
}: {
  projects: Project[];
  tasks: Task[];
  selectedProjectId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

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

  const commitAdd = useCallback(() => {
    const name = newName.trim();
    if (name) {
      onCreate(name);
    }
    setNewName('');
    setAdding(false);
  }, [newName, onCreate]);

  const startRename = useCallback((project: Project) => {
    setRenamingId(project.id);
    setRenameText(project.name);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId === null) {
      return;
    }
    const name = renameText.trim();
    if (name) {
      onRename(renamingId, name);
    }
    setRenamingId(null);
    setRenameText('');
  }, [renamingId, renameText, onRename]);

  return (
    <div className="project-list">
      <div className="project-list-header">
        <span className="project-list-title">
          <FolderOpen size={13} />
          项目
        </span>
        <button
          type="button"
          className="project-add"
          title="新建项目"
          aria-label="新建项目"
          onClick={() => setAdding((value) => !value)}
        >
          <Plus size={13} />
        </button>
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
                setNewName('');
                setAdding(false);
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
              <li
                key={project.id}
                className={`project-item ${selectedProjectId === project.id ? 'is-active' : ''}`.trim()}
                style={{ ['--chip-color' as string]: project.color ?? '#8aa0a6' }}
                onClick={() => onSelect(selectedProjectId === project.id ? null : project.id)}
              >
                <span className="project-item-dot" />
                {renamingId === project.id ? (
                  <input
                    className="project-rename-input"
                    type="text"
                    autoFocus
                    value={renameText}
                    maxLength={PROJECT_NAME_MAX}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameText(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitRename();
                      } else if (event.key === 'Escape') {
                        event.stopPropagation();
                        setRenamingId(null);
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
                      startRename(project);
                    }}
                  >
                    {project.name}
                  </span>
                )}
                <span className="project-item-count">{count}</span>
                <button
                  type="button"
                  className="project-item-remove"
                  title="删除项目"
                  aria-label={`删除项目「${project.name}」`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(project.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
