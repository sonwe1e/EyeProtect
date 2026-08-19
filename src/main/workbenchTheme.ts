import type { Settings } from '../shared/types';

export const getWorkbenchBackgroundColor = (
  theme: Settings['theme'],
  systemUsesDarkColors: boolean
): string => theme === 'dark' || (theme === 'system' && systemUsesDarkColors) ? '#111614' : '#f7f8f6';
