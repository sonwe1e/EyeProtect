import type { CommandResult, FocusStatus, Task } from '../../../../shared/types';

/**
 * Complete the persisted task first. A rejected task write must leave the live
 * FocusSession untouched so the user can retry without losing tracked time.
 */
export async function completeTaskThenFocus(
  taskId: string,
  completeTask: (id: string) => Promise<CommandResult<Task[]>>,
  completeFocus: () => Promise<CommandResult<FocusStatus>>
): Promise<CommandResult<FocusStatus>> {
  const taskResult = await completeTask(taskId);
  if (!taskResult.ok) return taskResult;
  return completeFocus();
}
