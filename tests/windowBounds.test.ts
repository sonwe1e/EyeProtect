import assert from 'node:assert/strict';
import test from 'node:test';
import { ALERT_LAYOUT, getAlertBounds, type WindowRectangle } from '../src/main/windowBounds';

const assertInsideWorkArea = (bounds: WindowRectangle, workArea: WindowRectangle): void => {
  assert.ok(bounds.width > 0);
  assert.ok(bounds.height > 0);
  assert.ok(bounds.x >= workArea.x);
  assert.ok(bounds.y >= workArea.y);
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
};

const assertCentered = (bounds: WindowRectangle, workArea: WindowRectangle): void => {
  const leftGap = bounds.x - workArea.x;
  const rightGap = workArea.x + workArea.width - bounds.x - bounds.width;
  const topGap = bounds.y - workArea.y;
  const bottomGap = workArea.y + workArea.height - bounds.y - bounds.height;

  assert.ok(Math.abs(leftGap - rightGap) <= 1);
  assert.ok(Math.abs(topGap - bottomGap) <= 1);
};

test('alert bounds adapt to common work areas without overflowing', () => {
  const workAreas: WindowRectangle[] = [
    { x: 0, y: 0, width: 1280, height: 720 },
    { x: 0, y: 0, width: 1366, height: 728 },
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1920, y: 0, width: 1920, height: 1080 },
    { x: 0, y: 0, width: 3840, height: 2080 },
    { x: 0, y: 0, width: 900, height: 1400 }
  ];

  for (const workArea of workAreas) {
    const bounds = getAlertBounds(workArea);
    assertInsideWorkArea(bounds, workArea);
    assertCentered(bounds, workArea);
  }
});

test('alert bounds preserve the reminder artwork aspect when space allows', () => {
  const workAreas: WindowRectangle[] = [
    { x: 0, y: 0, width: 1280, height: 720 },
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 3840, height: 2080 },
    { x: 0, y: 0, width: 900, height: 1400 }
  ];

  for (const workArea of workAreas) {
    const bounds = getAlertBounds(workArea);
    const artworkWidth = bounds.width - ALERT_LAYOUT.horizontalPadding;
    const artworkHeight = bounds.height - ALERT_LAYOUT.topPadding - ALERT_LAYOUT.panelReservedSpace;

    assert.ok(artworkWidth > 0);
    assert.ok(artworkHeight > 0);
    assert.ok(Math.abs(artworkWidth / artworkHeight - ALERT_LAYOUT.artworkAspect) < 0.02);
  }
});

test('alert bounds shrink for small displays instead of relying on desktop minimums', () => {
  const workArea = { x: 0, y: 0, width: 640, height: 480 };
  const bounds = getAlertBounds(workArea);

  assertInsideWorkArea(bounds, workArea);
  assert.ok(bounds.width < 640);
  assert.ok(bounds.height < 480);
});
