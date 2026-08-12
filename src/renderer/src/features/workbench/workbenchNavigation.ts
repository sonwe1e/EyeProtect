// Single source of truth for Workbench navigation hierarchy.
//
// Pure data on purpose: unit tests and the static verifier import this file
// directly in Node, so it must stay free of React/JSX/Electron dependencies.
// The iconKey -> Lucide component mapping lives in the React layer
// (WorkbenchSidebar) so this contract can be asserted without rendering.

export const PRIMARY_WORKBENCH_SECTIONS = [
  'today',
  'inbox',
  'plan',
  'focus',
  'projects'
] as const;

export const UTILITY_WORKBENCH_SECTIONS = [
  'review',
  'reminders',
  'collection',
  'settings'
] as const;

export type WorkbenchSectionId =
  | (typeof PRIMARY_WORKBENCH_SECTIONS)[number]
  | (typeof UTILITY_WORKBENCH_SECTIONS)[number];

export type WorkbenchSectionTier = 'primary' | 'utility';

export interface WorkbenchSectionMeta {
  id: WorkbenchSectionId;
  label: string;
  iconKey: string;
  tier: WorkbenchSectionTier;
}

// Labels mirror the existing WorkbenchView copy so this refactor changes
// structure, not wording. iconKey is resolved to a Lucide component in
// WorkbenchSidebar.tsx.
export const WORKBENCH_SECTIONS: Record<WorkbenchSectionId, WorkbenchSectionMeta> = {
  today: { id: 'today', label: '今天', iconKey: 'sun', tier: 'primary' },
  inbox: { id: 'inbox', label: '收件箱', iconKey: 'inbox', tier: 'primary' },
  plan: { id: 'plan', label: '计划', iconKey: 'calendarDays', tier: 'primary' },
  focus: { id: 'focus', label: '专注', iconKey: 'target', tier: 'primary' },
  projects: { id: 'projects', label: '项目', iconKey: 'folderKanban', tier: 'primary' },
  review: { id: 'review', label: '今日复盘', iconKey: 'calendarDays', tier: 'utility' },
  reminders: { id: 'reminders', label: '独立提醒', iconKey: 'bell', tier: 'utility' },
  collection: { id: 'collection', label: '公仔收藏', iconKey: 'gift', tier: 'utility' },
  settings: { id: 'settings', label: '设置', iconKey: 'settings', tier: 'utility' }
} as const;

export const PRIMARY_SECTION_ORDER: WorkbenchSectionId[] = PRIMARY_WORKBENCH_SECTIONS.slice();

export const UTILITY_SECTION_ORDER: WorkbenchSectionId[] = UTILITY_WORKBENCH_SECTIONS.slice();

export const WORKBENCH_SHORTCUTS = {
  command: 'k',
  newTask: 'n',
  plan: 'p',
  focus: 'f'
} as const;

export type WorkbenchShortcut = keyof typeof WORKBENCH_SHORTCUTS;

export function isPrimarySection(id: WorkbenchSectionId): boolean {
  return (PRIMARY_WORKBENCH_SECTIONS as readonly string[]).includes(id);
}

export function isUtilitySection(id: WorkbenchSectionId): boolean {
  return (UTILITY_WORKBENCH_SECTIONS as readonly string[]).includes(id);
}
