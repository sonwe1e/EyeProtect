import type { Settings } from '../shared/types';

export const getWorkbenchBackgroundColor = (
  theme: Settings['theme'],
  systemUsesDarkColors: boolean
): string => theme === 'dark' || (theme === 'system' && systemUsesDarkColors) ? '#111518' : '#f5f6f7';
