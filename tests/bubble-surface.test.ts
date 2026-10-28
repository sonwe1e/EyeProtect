import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  HYDRATION_BUBBLE_SIZE,
  resolveBubbleSurface,
  type BubbleSurface,
  type BubbleSurfaceInput
} from '../src/shared/bubbleSurface';

/**
 * One bubble window, five possible cards. The main process sizes the window from
 * this function and the renderer picks the component from it, so an order bug
 * here shows up as a clipped card, not as a wrong label.
 */
const base: BubbleSurfaceInput = {
  preAlert: false,
  gentleReminderId: null,
  pomodoroPhase: 'idle',
  hydrationPrompt: null
};

const kindOf = (input: Partial<BubbleSurfaceInput>): BubbleSurface =>
  resolveBubbleSurface({ ...base, ...input }).kind;

test('the five surfaces resolve in the documented priority order', () => {
  // Every candidate present at once: only the highest may win.
  assert.equal(
    kindOf({
      preAlert: true,
      gentleReminderId: 'rem-1',
      pomodoroPhase: 'focus',
      hydrationPrompt: { id: 'h1', phase: 'strip' }
    }),
    'prealert'
  );
  assert.equal(
    kindOf({ gentleReminderId: 'rem-1', pomodoroPhase: 'focus', hydrationPrompt: { id: 'h1', phase: 'strip' } }),
    'gentle'
  );
  assert.equal(kindOf({ pomodoroPhase: 'focus', hydrationPrompt: { id: 'h1', phase: 'strip' } }), 'pomodoro');
  assert.equal(kindOf({ hydrationPrompt: { id: 'h1', phase: 'strip' } }), 'hydration');
  assert.equal(kindOf({}), 'todo');
});

test('every pair keeps the documented order, not just the full set', () => {
  const order: BubbleSurface[] = ['prealert', 'gentle', 'pomodoro', 'hydration', 'todo'];
  const stateFor = (kind: BubbleSurface): Partial<BubbleSurfaceInput> => {
    switch (kind) {
      case 'prealert': return { preAlert: true };
      case 'gentle': return { gentleReminderId: 'rem-1' };
      case 'pomodoro': return { pomodoroPhase: 'break' };
      case 'hydration': return { hydrationPrompt: { id: 'h1', phase: 'strip' } };
      default: return {};
    }
  };
  for (let high = 0; high < order.length; high += 1) {
    for (let low = high + 1; low < order.length; low += 1) {
      assert.equal(
        kindOf({ ...stateFor(order[high]), ...stateFor(order[low]) }),
        order[high],
        `${order[high]} must beat ${order[low]}`
      );
    }
  }
});

test('the key identifies the exact surface, so change detection is honest', () => {
  // A different reminder is a different card even though the kind matches.
  assert.notEqual(
    resolveBubbleSurface({ ...base, gentleReminderId: 'rem-1' }).key,
    resolveBubbleSurface({ ...base, gentleReminderId: 'rem-2' }).key
  );
  // A phase change is a different layout (the pomodoro card changes).
  assert.notEqual(
    resolveBubbleSurface({ ...base, pomodoroPhase: 'focus' }).key,
    resolveBubbleSurface({ ...base, pomodoroPhase: 'break' }).key
  );
  // A new hydration prompt is a new moment, not a re-render of the old one.
  assert.notEqual(
    resolveBubbleSurface({ ...base, hydrationPrompt: { id: 'h1', phase: 'strip' } }).key,
    resolveBubbleSurface({ ...base, hydrationPrompt: { id: 'h2', phase: 'strip' } }).key
  );
  // The same state is stable.
  assert.equal(resolveBubbleSurface(base).key, resolveBubbleSurface(base).key);
});

test('the sipping phase does not take the bubble away (it plays on the pet)', () => {
  assert.equal(kindOf({ hydrationPrompt: { id: 'h1', phase: 'sipping' } }), 'todo');
  // …and it must not outrank the todo preview either, because nothing is shown.
  assert.equal(resolveBubbleSurface({ ...base, hydrationPrompt: { id: 'h1', phase: 'sipping' } }).key, 'todo');
});

test('the hydration window is sized for one sentence, a count and one action', () => {
  // The value is only a starting point (the renderer reports the real height),
  // but it must still be a workable card: wider than the todo bubble's 260 and
  // shorter than the gentle reminder's 224.
  assert.ok(HYDRATION_BUBBLE_SIZE.width >= 260 && HYDRATION_BUBBLE_SIZE.width <= 320);
  assert.ok(HYDRATION_BUBBLE_SIZE.height >= 140 && HYDRATION_BUBBLE_SIZE.height <= 200);
});

test('sipping and strip are different surfaces, so the window is resized between them', () => {
  const sipping = resolveBubbleSurface({ ...base, hydrationPrompt: { id: 'h1', phase: 'sipping' } });
  const strip = resolveBubbleSurface({ ...base, hydrationPrompt: { id: 'h1', phase: 'strip' } });
  assert.equal(sipping.kind, 'todo');
  assert.equal(strip.kind, 'hydration');
  assert.notEqual(sipping.key, strip.key, 'the main process resets its measured height on a key change');
});

// ── Wiring contract: one function, two consumers (source scan) ──────────────

const repository = resolve(import.meta.dirname, '..');
const readSource = (relative: string): string => readFileSync(resolve(repository, relative), 'utf8');

test('the main process and the renderer resolve the surface with the same function', () => {
  const windows = readSource('src/main/windows.ts');
  const view = readSource('src/renderer/src/views/BubbleView.tsx');
  assert.match(windows, /resolveBubbleSurface[^;]*from '\.\.\/shared\/bubbleSurface'/, 'windows must import the shared resolver');
  assert.match(view, /resolveBubbleSurface[^;]*from '\.\.\/\.\.\/\.\.\/shared\/bubbleSurface'/, 'BubbleView must import the shared resolver');
  // Both hand over the prompt object itself (not a boolean), so the strip phase
  // is the only thing that can claim the bubble.
  assert.match(windows, /hydrationPrompt: hydration\.prompt/);
  assert.match(view, /hydrationPrompt: hydration\?\.prompt \?\? null/);
});

test('showing or retiring a strip re-evaluates the bubble before the renderer is told', () => {
  const windows = readSource('src/main/windows.ts');
  const body = windows.slice(windows.indexOf('broadcastHydration('));
  const refreshAt = body.indexOf('this.refreshBubble()');
  const sendAt = body.indexOf("'hydration:changed'");
  assert.ok(refreshAt >= 0, 'a hydration change must re-evaluate the surface');
  assert.ok(sendAt > refreshAt, 'resize the window before the renderer swaps the card');
});

test('the hydration height is only a default; the renderer measurement still wins', () => {
  const windows = readSource('src/main/windows.ts');
  const size = windows.slice(windows.indexOf('private getBubbleSize'), windows.indexOf('private positionBubbleWindow'));
  assert.match(size, /this\.bubbleHeight = null/, 'a new surface must not inherit the previous card height');
  assert.match(size, /height: this\.bubbleHeight \?\? HYDRATION_BUBBLE_SIZE\.height/);
});
