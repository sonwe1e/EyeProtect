/**
 * Project section grouping helpers (USERPLAN 1.2 PR5, ADR-002).
 *
 * Board columns ARE sections — workflow stages owned by the project. The
 * global active/focus task only earns a "正在专注" badge on its card; it must
 * never decide which column a task lives in.
 */
import type { ProjectSection, Task } from './types';

export interface SectionGroup {
  /** `null` is the "未分组" group — tasks not assigned to any section. */
  sectionId: string | null;
  title: string;
  tasks: Task[];
}

export const UNSECTIONED_TITLE = '未分组';

/**
 * Group a project's tasks for Board/List rendering. The unsectioned group
 * comes first when non-empty (a board of only real sections stays clean once
 * everything is triaged); section groups follow in section order. Task order
 * inside a group preserves the caller's ordering (sortOrder-sorted input).
 */
export const groupTasksBySection = (
  tasks: Task[],
  sections: ProjectSection[]
): SectionGroup[] => {
  const bySection = new Map<string, Task[]>();
  const unsectioned: Task[] = [];
  const known = new Set(sections.map((section) => section.id));
  for (const task of tasks) {
    if (task.sectionId && known.has(task.sectionId)) {
      bySection.set(task.sectionId, [...(bySection.get(task.sectionId) ?? []), task]);
    } else {
      unsectioned.push(task);
    }
  }
  const groups: SectionGroup[] = [];
  if (unsectioned.length > 0 || sections.length === 0) {
    groups.push({ sectionId: null, title: UNSECTIONED_TITLE, tasks: unsectioned });
  }
  for (const section of sections) {
    groups.push({
      sectionId: section.id,
      title: section.name,
      tasks: bySection.get(section.id) ?? []
    });
  }
  return groups;
};
