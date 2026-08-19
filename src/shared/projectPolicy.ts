/**
 * Project lifecycle policy (USERPLAN 1.2 PR7).
 *
 * Pure, side-effect-free rules that translate a Project's status into concrete
 * permissions. Every consumer that mutates tasks or plans MUST route through
 * these functions so the lifecycle can never be a "visual label" that some
 * entry points understand and others ignore.
 *
 * Rules (conservative, reversible, no data migration):
 *
 *   status      new tasks   edit tasks   Today/Focus/Plan
 *   active       yes         yes          yes
 *   onHold       no          yes          no  (existing plans stay)
 *   completed    no           no          no  (existing plans stay)
 *   archived     no           no          no  (existing plans stay)
 *
 * "existing plans stay" means: a DailyTaskPlan or TimeBlock created before the
 * status change is NOT silently removed. The policy only gates NEW mutations.
 */

import type { Project, ProjectStatus, Task } from './types';

/** Only active projects accept brand-new tasks. */
export const isProjectAssignable = (project: Project | null | undefined): boolean =>
  project?.status === 'active';

/** Active and onHold projects allow editing existing tasks; completed/archived are read-only. */
export const isProjectWritable = (project: Project | null | undefined): boolean =>
  project?.status === 'active' || project?.status === 'onHold';

/**
 * Whether a task may appear in Today / Focus / Plan candidates.
 * A task whose project is completed or archived is excluded from active planning
 * even if its own status is still 'open'. Inbox tasks (no project) always qualify.
 * Tasks with an unknown/missing project reference are included (conservative default —
 * only exclude when we can confirm the project is completed or archived).
 */
export const isTaskAvailableForPlanning = (
  task: Task,
  project: Project | null | undefined
): boolean => {
  if (!task.projectId) return true;
  if (!project) return true;
  return project.status === 'active' || project.status === 'onHold';
};

/** All statuses in their natural display order. */
export const PROJECT_LIFECYCLE_ORDER: ProjectStatus[] = ['active', 'onHold', 'completed', 'archived'];
