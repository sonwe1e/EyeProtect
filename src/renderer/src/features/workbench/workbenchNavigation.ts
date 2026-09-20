/** The only top-level destinations in the simplified workbench. */
export const PRIMARY_WORKBENCH_SECTIONS = ['today', 'review'] as const;
export const UTILITY_WORKBENCH_SECTIONS = ['settings'] as const;
export const CONTEXTUAL_WORKBENCH_SECTIONS = [] as const;
export type WorkbenchSectionId = 'today' | 'review' | 'settings';
export const WORKBENCH_SECTIONS = {
  today: { id: 'today', label: '待办', description: '按截止日期查看未完成任务', tier: 'primary' },
  review: { id: 'review', label: '完成记录', description: '查看何时完成了什么任务', tier: 'primary' },
  settings: { id: 'settings', label: '设置', description: '休息提醒、桌面外观与应用', tier: 'utility' }
} as const;
export const PRIMARY_SECTION_ORDER = [...PRIMARY_WORKBENCH_SECTIONS];
export const UTILITY_SECTION_ORDER = [...UTILITY_WORKBENCH_SECTIONS];
