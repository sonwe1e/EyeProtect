export type ReminderSurfaceResult = 'primary' | 'emergency' | 'notification' | 'none';

export interface ReminderSurfaceFallbacks {
  primary: () => boolean | Promise<boolean>;
  emergency: () => boolean | Promise<boolean>;
  notification: () => boolean | Promise<boolean>;
  isCurrent?: () => boolean;
  onError?: (surface: Exclude<ReminderSurfaceResult, 'none'>, error: unknown) => void;
}

/** Pure fallback state machine so cancellation and all failure branches can be
 * verified without starting Electron. */
export const runReminderSurfaceFallback = async ({
  primary,
  emergency,
  notification,
  isCurrent = () => true,
  onError = () => undefined
}: ReminderSurfaceFallbacks): Promise<ReminderSurfaceResult> => {
  const attempts = [
    ['primary', primary],
    ['emergency', emergency],
    ['notification', notification]
  ] as const;
  for (const [surface, show] of attempts) {
    if (!isCurrent()) return 'none';
    try {
      if (await show()) return surface;
    } catch (error) {
      onError(surface, error);
    }
  }
  return 'none';
};
