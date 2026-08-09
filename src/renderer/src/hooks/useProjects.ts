import { useEffect, useState } from 'react';
import type { Project } from '../../../shared/types';

export const useProjects = (): Project[] => {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getProjects().then((next) => {
      if (mounted && next) {
        setProjects(next);
      }
    });
    const offProjects = window.eyeProtect.onProjectsChanged(setProjects);
    return () => {
      mounted = false;
      offProjects();
    };
  }, []);

  return projects;
};
