import { getPetBubbleLayout } from '../src/main/windowBounds';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ALERT_LAYOUT, getAlertBounds, getPetMoveBounds, type WindowRectangle } from '../src/main/windowBounds';

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

test('alert bounds use a compact maximum instead of inheriting legacy artwork dimensions', () => {
  const workAreas: WindowRectangle[] = [
    { x: 0, y: 0, width: 1280, height: 720 },
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 3840, height: 2080 },
    { x: 0, y: 0, width: 900, height: 1400 }
  ];

  for (const workArea of workAreas) {
    const bounds = getAlertBounds(workArea);
    assert.ok(bounds.width <= ALERT_LAYOUT.targetWidth);
    assert.ok(bounds.height <= ALERT_LAYOUT.targetHeight);
    if (workArea.width >= ALERT_LAYOUT.targetWidth + ALERT_LAYOUT.edgeGapMax * 2) {
      assert.equal(bounds.width, ALERT_LAYOUT.targetWidth);
    }
  }
});

test('alert bounds shrink for small displays instead of relying on desktop minimums', () => {
  const workArea = { x: 0, y: 0, width: 640, height: 480 };
  const bounds = getAlertBounds(workArea);

  assertInsideWorkArea(bounds, workArea);
  assert.ok(bounds.width < 640);
  assert.ok(bounds.height < 480);
});

test('pet move bounds restore the configured size after native DPI drift', () => {
  const workArea = { x: -1920, y: 0, width: 1920, height: 1080 };
  const bounds = getPetMoveBounds(
    { x: -1200, y: 240 },
    workArea,
    { width: 160, height: 160 }
  );

  assert.deepEqual(bounds, { x: -1200, y: 240, width: 160, height: 160 });
  assert.equal(getPetMoveBounds({ x: 400, y: 900 }, workArea, { width: 160, height: 160 }).width, 160);
  assert.equal(getPetMoveBounds({ x: 400, y: 900 }, workArea, { width: 160, height: 160 }).height, 160);
});

test('pet move bounds clamp against the work area using the fixed configured size', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 720 };
  assert.deepEqual(
    getPetMoveBounds({ x: -200, y: 900 }, workArea, { width: 288, height: 288 }),
    { x: 0, y: 432, width: 288, height: 288 }
  );
});


test('bubble follows every move with fixed artwork gap and content-dependent height', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  for (const height of [92, 124, 156]) {
    for (let x = 300; x < 1100; x += 7) {
      const layout = getPetBubbleLayout({ x, y: 500, width: 160, height: 160 }, workArea, { width: 260, height });
      assert.equal(layout.placement, 'above');
      assert.equal(layout.bounds.x + layout.bounds.width / 2, x + 80);
      assert.equal(layout.bounds.y + height, 520);
    }
  }
});

test('bubble flips below and clamps on negative-origin displays and small work areas', () => {
  for (const area of [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 240, height: 240 }]) {
    const layout = getPetBubbleLayout({ x: area.x, y: area.y, width: 160, height: 160 }, area, { width: 260, height: 156 });
    assert.equal(layout.placement, 'below');
    assertInsideWorkArea(layout.bounds, area);
    assert.ok(layout.tailX >= 18 && layout.tailX <= layout.bounds.width - 30);
  }
});


test('legacy artwork uses its reported silhouette rather than a fixed pixel-animal head', () => {
  const pet = { x: 300, y: 500, width: 160, height: 160 };
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const result = getPetBubbleLayout(pet, area, { width: 260, height: 140 }, { top: .25, bottom: .8 });
  assert.equal(result.bounds.y + result.bounds.height, 540);
});
