import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../../../shared/types';

/**
 * Project subscription (USERPLAN 1.2 PR2: incremental renderer state).
 * Hydrates once via `project:list`, then applies `project:upserted` /
 * `project:removed` deltas; the full-list channel remains the bulk resync
 * for import/rollback. Ordering follows the store (sortOrder, createdAt).
 */
export const useProjects = (): Project[] => {
  const [projectMap, setProjectMap] = useState<Map<string, Project>>(() => new Map());

  useEffect(() => {
    let mounted = true;
    const hydrate = (list: Project[]): void => {
      setProjectMap(new Map(list.map((project) => [project.id, project])));
    };
    void window.eyeProtect.getProjects().then((next) => {
      if (mounted && next) {
        hydrate(next);
      }
    });
    const offUpserted = window.eyeProtect.onProjectUpserted((project) => {
      setProjectMap((previous) => {
        const next = new Map(previous);
        next.set(project.id, project);
        return next;
      });
    });
    const offRemoved = window.eyeProtect.onProjectRemoved((projectId) => {
      setProjectMap((previous) => {
        if (!previous.has(projectId)) return previous;
        const next = new Map(previous);
        next.delete(projectId);
        return next;
      });
    });
    const offBulk = window.eyeProtect.onProjectsChanged((list) => {
      hydrate(list);
    });
    return () => {
      mounted = false;
      offUpserted();
      offRemoved();
      offBulk();
    };
  }, []);

  return useMemo(
    () =>
      [...projectMap.values()].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt
      ),
    [projectMap]
  );
};
