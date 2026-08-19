import { useCallback, useEffect, useState } from 'react';
import type { ProjectSection } from '../../../shared/types';

/**
 * Project section subscription (USERPLAN 1.2 PR5). Hydrates via
 * `section:list`, then follows `section:changed` pushes (payload
 * `projectId === null` means a bulk replace, e.g. backup import).
 */
export const useProjectSections = (projectId: string): {
  sections: ProjectSection[];
  refresh: () => void;
} => {
  const [sections, setSections] = useState<ProjectSection[]>([]);

  const refresh = useCallback(() => {
    let cancelled = false;
    void window.eyeProtect.getProjectSections(projectId).then((next) => {
      if (!cancelled) setSections(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    // Do not briefly show the previous project's sections while the new list
    // is in flight; a project/section draft must always describe one project.
    setSections([]);
    const cancel = refresh();
    const offChanged = window.eyeProtect.onProjectSectionsChanged((payload) => {
      if (!payload.projectId || payload.projectId === projectId) refresh();
    });
    const offBulk = window.eyeProtect.onTasksChanged(() => refresh());
    return () => {
      cancel();
      offChanged();
      offBulk();
    };
  }, [refresh, projectId]);

  return { sections, refresh };
};
