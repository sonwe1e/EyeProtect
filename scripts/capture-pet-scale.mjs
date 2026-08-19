import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call, delay, evaluate, waitFor, waitForTarget } from './lib/cdp.mjs';

const port = Number(process.argv[2] ?? 9333);
const outputDir = resolve(process.argv[3] ?? 'artifacts/pet-scale');
const endpoint = `http://127.0.0.1:${port}`;
const scales = [50, 60, 69, 70, 100];

mkdirSync(outputDir, { recursive: true });
const pet = await waitForTarget(endpoint, '#pet');

for (const percent of scales) {
  await evaluate(pet, `window.eyeProtect.saveSettings({ petScale: ${percent / 100} })`);
  let state;
  const expectedSize = Math.round(160 * percent / 100);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    state = await evaluate(pet, `(() => ({
      width: innerWidth,
      height: innerHeight,
      toolbar: Boolean(document.querySelector('.pet-toolbar')),
      character: Boolean(document.querySelector('.pet-character .procedural-character svg')),
      dragSurface: Boolean(document.querySelector('.pet-drag-surface')),
      secondaryChrome: ['.pet-care-badge', '.pet-gift-badge', '.pet-drag-handle']
        .some((selector) => {
          const element = document.querySelector(selector);
          return element && getComputedStyle(element).display !== 'none';
        })
    }))()`);
    if (state.width === expectedSize && state.height === expectedSize && state.character) break;
    await delay(50);
  }
  const toolbarExpected = percent >= 70;
  if (
    state?.width !== expectedSize ||
    state?.height !== expectedSize ||
    !state.character ||
    !state.dragSurface ||
    state.toolbar !== toolbarExpected ||
    state.secondaryChrome !== toolbarExpected
  ) {
    throw new Error(`Pet scale ${percent}% failed: ${JSON.stringify({ expectedSize, toolbarExpected, state })}`);
  }
  const screenshot = await call(pet, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  });
  const image = Buffer.from(screenshot.data, 'base64');
  if (image.length < 500) throw new Error(`Pet scale ${percent}% produced an empty screenshot`);
  writeFileSync(resolve(outputDir, `pet-${percent}.png`), image);

  const center = await evaluate(pet, `(() => {
    const rect = document.querySelector('.pet-character')?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.45 } : null;
  })()`);
  if (!center) throw new Error(`Pet scale ${percent}% had no interactive character center`);

  await call(pet, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', buttons: 1, clickCount: 1 });
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y, button: 'left', buttons: 0, clickCount: 1 });
  await waitFor(pet, `document.querySelector('.pet-character')?.classList.contains('is-reacting') === true`);
  await waitFor(pet, `document.querySelector('.pet-character')?.classList.contains('is-reacting') === false`);

  const beforeDrag = await evaluate(pet, `({
    x: window.screenX,
    y: window.screenY,
    width: window.innerWidth,
    height: window.innerHeight
  })`);
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    const position = await evaluate(pet, `({ x: window.screenX, y: window.screenY })`);
    const targetScreenX = beforeDrag.x + center.x - step * 8;
    const targetScreenY = beforeDrag.y + center.y - step * 6;
    await call(pet, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: targetScreenX - position.x,
      y: targetScreenY - position.y,
      button: 'left',
      buttons: 1
    });
    const viewport = await evaluate(pet, `({ width: window.innerWidth, height: window.innerHeight })`);
    if (viewport.width !== beforeDrag.width || viewport.height !== beforeDrag.height) {
      throw new Error(`Pet scale ${percent}% resized while dragging: ${JSON.stringify({ beforeDrag, viewport, step })}`);
    }
  }
  const releasePosition = await evaluate(pet, `({ x: window.screenX, y: window.screenY })`);
  await call(pet, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: beforeDrag.x + center.x - 64 - releasePosition.x,
    y: beforeDrag.y + center.y - 48 - releasePosition.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await waitFor(pet, `window.screenX !== ${beforeDrag.x} || window.screenY !== ${beforeDrag.y}`);
  const afterDrag = await evaluate(pet, `({ width: window.innerWidth, height: window.innerHeight })`);
  if (afterDrag.width !== beforeDrag.width || afterDrag.height !== beforeDrag.height) {
    throw new Error(`Pet scale ${percent}% changed size after dragging: ${JSON.stringify({ beforeDrag, afterDrag })}`);
  }
  await delay(500);

  for (const [type, clickCount] of [['mousePressed', 1], ['mouseReleased', 1], ['mousePressed', 2], ['mouseReleased', 2]]) {
    await call(pet, 'Input.dispatchMouseEvent', { type, x: center.x, y: center.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount });
  }
  const workbench = await waitForTarget(endpoint, '#workbench');
  await waitFor(workbench, `Boolean(document.querySelector('.today-page'))`);
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'right', buttons: 2, clickCount: 1 });
  await call(pet, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y, button: 'right', buttons: 0, clickCount: 1 });
  await waitFor(workbench, `Boolean(document.querySelector('.collection-page'))`);
}

await evaluate(pet, `window.eyeProtect.saveSettings({ petScale: 1 })`);
console.log(`Captured and interaction-tested pet scales ${scales.join(', ')} to ${outputDir}`);
