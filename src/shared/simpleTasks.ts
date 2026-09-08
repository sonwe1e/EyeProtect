import { addLocalDays, localDateKey } from './calendar';
import type { Task, Project } from './types';

export const isSimpleList = (project: Project): boolean => project.status === 'active' || project.status === 'onHold';
export const isCurrentTask = (task: Task, projects: Project[]): boolean =>
  !task.parentId && task.status !== 'archived' && (!task.projectId || projects.some((p) => p.id === task.projectId && isSimpleList(p)));

export const taskSteps = (rootId: string, tasks: Task[]): Task[] => {
  const seen = new Set([rootId]);
  const result: Task[] = [];
  const visit = (id: string): void => {
    for (const child of tasks.filter((task) => task.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return result;
};

export const TASK_GROUPS = ['逾期', '今天', '未来 7 天', '更晚', '无日期'] as const;
export const groupSimpleTasks = (tasks: Task[], now: number): Array<{ title: string; tasks: Task[] }> => {
  const today = localDateKey(now);
  const end = localDateKey(addLocalDays(now, 7));
  const groups = TASK_GROUPS.map((title) => ({ title, tasks: [] as Task[] }));
  for (const task of tasks.filter((task) => !task.parentId && task.status === 'open')) {
    const date = task.dueDate;
    const index = !date ? 4 : date < today ? 0 : date === today ? 1 : date <= end ? 2 : 3;
    groups[index].tasks.push(task);
  }
  for (const group of groups) group.tasks.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  return groups;
};
