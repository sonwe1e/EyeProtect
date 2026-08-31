import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { TimeBlock } from '../../../shared/types';

/**
 * TimeBlock subscription (USERPLAN 1.2 PR4).
 *
 * Hydrates once via `timeblock:list`; mutations go through the command layer
 * and callers apply the fresh entity via `setBlocks`. Bulk task events (undo,
 * backup import, migration) refetch because they can replace tasks the
 * blocks belong to (FK CASCADE deletes them server-side).
 */
export const useTimeBlocks = (): {
  blocks: TimeBlock[];
  setBlocks: Dispatch<SetStateAction<TimeBlock[]>>;
  refresh: () => void;
} => {
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);

  const refresh = useCallback(() => {
    let cancelled = false;
    void window.eyeProtect.getTimeBlocks().then((next) => {
      if (!cancelled) setBlocks(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cancel = refresh();
    const offBulk = window.eyeProtect.onTasksChanged(() => refresh());
    const offBlocks = window.eyeProtect.onTimeBlocksChanged(() => refresh());
    return () => {
      cancel();
      offBulk();
      offBlocks();
    };
  }, [refresh]);

  return { blocks, setBlocks, refresh };
};
