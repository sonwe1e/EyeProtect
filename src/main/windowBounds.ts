export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ALERT_LAYOUT = {
  artworkAspect: 1448 / 1086,
  edgeGapRatio: 0.05,
  edgeGapMin: 16,
  edgeGapMax: 64,
  horizontalPadding: 44,
  topPadding: 18,
  panelReservedSpace: 320
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getAdaptiveMargin = (workArea: WindowRectangle): number => {
  const byScreen = Math.round(Math.min(workArea.width, workArea.height) * ALERT_LAYOUT.edgeGapRatio);
  const maxForWorkArea = Math.max(0, Math.floor((Math.min(workArea.width, workArea.height) - 1) / 2));
  return Math.min(clamp(byScreen, ALERT_LAYOUT.edgeGapMin, ALERT_LAYOUT.edgeGapMax), maxForWorkArea);
};

export const getAlertBounds = (workArea: WindowRectangle): WindowRectangle => {
  const margin = getAdaptiveMargin(workArea);
  const availableWidth = Math.max(1, workArea.width - margin * 2);
  const availableHeight = Math.max(1, workArea.height - margin * 2);
  const verticalChrome = ALERT_LAYOUT.topPadding + ALERT_LAYOUT.panelReservedSpace;
  const artworkHeight = Math.max(1, availableHeight - verticalChrome);
  const aspectAwareWidth = Math.round(artworkHeight * ALERT_LAYOUT.artworkAspect + ALERT_LAYOUT.horizontalPadding);
  const width = Math.min(availableWidth, aspectAwareWidth);
  const aspectAwareHeight = Math.round(
    Math.max(1, width - ALERT_LAYOUT.horizontalPadding) / ALERT_LAYOUT.artworkAspect + verticalChrome
  );
  const height = Math.min(availableHeight, aspectAwareHeight);

  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  };
};
