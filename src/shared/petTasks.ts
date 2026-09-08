import { isProjectWritable } from './projectPolicy';
import type { Project, Task } from './types';

export const isPetTaskEligible = (task: Task, projects: Project[]): boolean =>
  !task.parentId && task.status !== 'done' && task.status !== 'archived' &&
  (!task.projectId || isProjectWritable(projects.find((project) => project.id === task.projectId)));

export const selectPetTasks = (ids: string[], tasks: Task[], projects: Project[]): Task[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return [...new Set(ids)].flatMap((id) => {
    const task = byId.get(id);
    return task && isPetTaskEligible(task, projects) ? [task] : [];
  });
};
