import type { ReminderMode } from './types';

/**
 * Which surface presents an active reminder, by mode. This mapping is the
 * single source of truth for the three reminder modes the Settings page
 * advertises, and every mode is a real, distinct runtime behaviour:
 *
 * - 'gentle' — the reminder lives in the bubble anchored to the pet: no alert
 *   window, no dimming, the pet stays on screen and work is not interrupted.
 * - 'guided' — the Alert window takes over (the pet yields) but the desktop is
 *   NOT dimmed, and the rest wait is not enforced (complete is immediate).
 * - 'focused' — the immersive mask: the Alert window plus dim overlays and an
 *   enforced rest wait.
 */
export const reminderSurfaceForMode = (mode: ReminderMode): 'alert' | 'bubble' =>
  mode === 'gentle' ? 'bubble' : 'alert';

/** Only the immersive (focused) mode dims the desktop behind the alert card. */
export const reminderDimsDesktopForMode = (mode: ReminderMode): boolean => mode === 'focused';

/**
 * Only the immersive (focused) mode enforces the rest wait; gentle and guided
 * reminders can be completed as soon as they appear.
 */
export const reminderEnforcesRestWait = (mode: ReminderMode): boolean => mode === 'focused';
