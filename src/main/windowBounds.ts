export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ALERT_LAYOUT = {
  edgeGapRatio: 0.05,
  edgeGapMin: 16,
  edgeGapMax: 64,
  targetWidth: 760,
  targetHeight: 720,
  minimumWidth: 480,
  minimumHeight: 440,
  panelReservedSpace: 320
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const getPetMoveBounds = (
  position: { x: number; y: number },
  workArea: WindowRectangle,
  size: { width: number; height: number }
): WindowRectangle => {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - size.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - size.height);
  return {
    x: Math.round(clamp(position.x, workArea.x, maxX)),
    y: Math.round(clamp(position.y, workArea.y, maxY)),
    width: size.width,
    height: size.height
  };
};

const getAdaptiveMargin = (workArea: WindowRectangle): number => {
  const byScreen = Math.round(Math.min(workArea.width, workArea.height) * ALERT_LAYOUT.edgeGapRatio);
  const maxForWorkArea = Math.max(0, Math.floor((Math.min(workArea.width, workArea.height) - 1) / 2));
  return Math.min(clamp(byScreen, ALERT_LAYOUT.edgeGapMin, ALERT_LAYOUT.edgeGapMax), maxForWorkArea);
};

export const getAlertBounds = (workArea: WindowRectangle): WindowRectangle => {
  const margin = getAdaptiveMargin(workArea);
  const availableWidth = Math.max(1, workArea.width - margin * 2);
  const availableHeight = Math.max(1, workArea.height - margin * 2);
  const width = Math.min(availableWidth, Math.max(ALERT_LAYOUT.minimumWidth, ALERT_LAYOUT.targetWidth));
  const height = Math.min(availableHeight, Math.max(ALERT_LAYOUT.minimumHeight, ALERT_LAYOUT.targetHeight));

  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  };
};
