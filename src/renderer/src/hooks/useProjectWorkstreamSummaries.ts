import { useCallback, useEffect, useState } from 'react';
import type { ProjectWorkstreamSummary } from '../../../shared/types';

export const useProjectWorkstreamSummaries = (projectId: string, since: number): ProjectWorkstreamSummary[] => {
  const [summaries, setSummaries] = useState<ProjectWorkstreamSummary[]>([]);
  const refresh = useCallback(() => {
    void window.eyeProtect.getProjectWorkstreamSummaries(projectId, since).then(setSummaries);
  }, [projectId, since]);
  useEffect(() => {
    refresh();
    const offTask = window.eyeProtect.onTaskUpserted(refresh);
    const offFocus = window.eyeProtect.onFocusStatusChanged(refresh);
    const offCheckpoint = window.eyeProtect.onTaskCheckpointsChanged(refresh);
    return () => { offTask(); offFocus(); offCheckpoint(); };
  }, [refresh]);
  return summaries;
};
