/**
 * Which card the pet-anchored bubble is showing right now.
 *
 * The main process (window size, show/hide) and the renderer (which component
 * to mount) must agree exactly — a mismatch means a card rendered into a window
 * sized for something else, i.e. clipped or floating text. So the priority order
 * lives here once, and both sides call it with the raw state they already have.
 */
export type BubbleSurface = 'prealert' | 'gentle' | 'pomodoro' | 'hydration' | 'todo';

export interface BubbleSurfaceInput {
  preAlert: boolean;
  /** Only a gentle-mode active reminder uses the bubble; focused mode uses the alert window. */
  gentleReminderId: string | null;
  pomodoroPhase: string;
  /**
   * The hydration prompt, or null. Only the `strip` phase owns the bubble — the
   * sipping phase plays on the pet and must not take the surface away.
   */
  hydrationPrompt: { id: string; phase: 'sipping' | 'strip' } | null;
}

export interface BubbleSurfaceResolution {
  kind: BubbleSurface;
  /**
   * Identity of this exact surface, used for change detection. It carries what
   * makes two appearances different (the reminder, the pomodoro phase, the
   * hydration prompt) so a re-render is not mistaken for the same card.
   */
  key: string;
}

/**
 * Priority: pre-alert > gentle reminder > pomodoro > hydration > todo.
 * A hydration strip outranks the passive todo preview (it is a moment the user
 * can act on) but never outranks a real reminder or a running timer.
 */
export const resolveBubbleSurface = (input: BubbleSurfaceInput): BubbleSurfaceResolution => {
  if (input.preAlert) return { kind: 'prealert', key: 'prealert' };
  if (input.gentleReminderId) return { kind: 'gentle', key: `gentle-${input.gentleReminderId}` };
  if (input.pomodoroPhase !== 'idle') return { kind: 'pomodoro', key: `pomodoro-${input.pomodoroPhase}` };
  if (input.hydrationPrompt?.phase === 'strip') return { kind: 'hydration', key: `hydration-${input.hydrationPrompt.id}` };
  return { kind: 'todo', key: 'todo' };
};

/**
 * Room for one sentence, the count and two actions. Only a starting point: the
 * real height comes from the renderer's own measurement (`window:bubble:height`),
 * so this value can never clip the card.
 */
export const HYDRATION_BUBBLE_SIZE = { width: 300, height: 168 } as const;
