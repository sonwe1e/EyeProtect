export interface DisplayLayoutInput {
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor?: number;
  rotation?: number;
}

/**
 * Stable topology key independent of Electron's transient display ordering.
 * Physical bounds, scaling and rotation are enough to distinguish the layouts
 * in which an absolute pet position is meaningful.
 */
export const getDisplayLayoutKey = (
  displays: readonly DisplayLayoutInput[]
): string =>
  displays
    .map((display) => {
      const { x, y, width, height } = display.bounds;
      const scale = Number.isFinite(display.scaleFactor) ? display.scaleFactor : 1;
      const rotation = Number.isFinite(display.rotation) ? display.rotation : 0;
      return `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)},${scale},${rotation}`;
    })
    .sort()
    .join('|');
