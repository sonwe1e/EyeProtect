import type { Task } from '../../../../shared/types';

/**
 * Pure drag-reorder decision (USERPLAN 1.2 PR0: drag must actually persist).
 *
 * Returns the `beforeTaskId` to hand to `moveTask`, `null` to move the source
 * to the END of its sibling group, or `undefined` when the drop must be
 * ignored (self-drop, cross-parent drop, or an already-in-place drop).
 * Extracted from TaskList so the decision is unit-testable without React.
 */
export const resolveSiblingDrop = (
  orderedTasks: Task[],
  sourceId: string,
  targetId: string
): string | null | undefined => {
  if (sourceId === targetId) return undefined;
  const source = orderedTasks.find((entry) => entry.id === sourceId);
  const target = orderedTasks.find((entry) => entry.id === targetId);
  // Cross-parent drops are not reorders — silently ignore them instead of
  // pretending a section/project move happened.
  if (!source || !target || source.parentId !== target.parentId) return undefined;
  const siblings = orderedTasks.filter((entry) => entry.parentId === target.parentId);
  const sourceIndex = siblings.findIndex((entry) => entry.id === sourceId);
  const targetIndex = siblings.findIndex((entry) => entry.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return undefined;
  // Dropping onto the row directly below is already the current order.
  if (sourceIndex === targetIndex - 1) return undefined;
  return target.id;
};
