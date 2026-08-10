import type { ProjectInput, ProjectUpdateInput } from '../shared/types';

const asCandidate = (value: unknown): Partial<ProjectInput> =>
  (value && typeof value === 'object' ? value : {}) as Partial<ProjectInput>;

export const asProjectInput = (value: unknown): ProjectInput => {
  const candidate = asCandidate(value);
  return {
    name: typeof candidate.name === 'string' ? candidate.name : '',
    goal: typeof candidate.goal === 'string' || candidate.goal === null ? candidate.goal : undefined,
    viewMode: candidate.viewMode === 'board' ? 'board' : candidate.viewMode === 'list' ? 'list' : undefined,
    color: typeof candidate.color === 'string' ? candidate.color : undefined,
    parentId: typeof candidate.parentId === 'string' ? candidate.parentId : undefined
  };
};

export const asProjectUpdateInput = (value: unknown): ProjectUpdateInput => {
  const candidate = asCandidate(value);
  const input: ProjectUpdateInput = {};
  if (typeof candidate.name === 'string') input.name = candidate.name;
  if (typeof candidate.goal === 'string' || candidate.goal === null) input.goal = candidate.goal;
  if (candidate.viewMode === 'board' || candidate.viewMode === 'list') input.viewMode = candidate.viewMode;
  if (typeof candidate.color === 'string' || candidate.color === null) input.color = candidate.color;
  if (typeof candidate.parentId === 'string' || candidate.parentId === null) input.parentId = candidate.parentId;
  return input;
};
