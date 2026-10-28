import assert from 'node:assert/strict';
import test from 'node:test';
import { CELEBRATE_SUPPRESS_MS, SIP_SUPPRESS_MS, createPetReactionGate } from '../src/main/petReactionThrottle';

const T0 = 1_000_000;

test('first completion reacts, everything inside the window stays silent', () => {
  const gate = createPetReactionGate();
  assert.equal(gate.shouldReact(T0), true, 'the first completion owns the window');
  assert.equal(gate.shouldReact(T0 + 1), false);
  assert.equal(gate.shouldReact(T0 + 29_999), false, '29.999s is still inside the 30s window');
});

test('the window reopens exactly after the suppression span', () => {
  const gate = createPetReactionGate();
  assert.equal(gate.shouldReact(T0), true);
  assert.equal(gate.shouldReact(T0 + CELEBRATE_SUPPRESS_MS), true, 'the boundary itself reopens');
  // The new reaction moves the window forward.
  assert.equal(gate.shouldReact(T0 + CELEBRATE_SUPPRESS_MS + 1), false);
  assert.equal(gate.shouldReact(T0 + 2 * CELEBRATE_SUPPRESS_MS), true);
});

test('suppression never queues: rejected events leave no delayed reaction', () => {
  const gate = createPetReactionGate();
  assert.equal(gate.shouldReact(T0), true);
  for (let n = 1; n <= 10; n += 1) {
    assert.equal(gate.shouldReact(T0 + n * 1_000), false, 'burst events stay silent');
  }
  assert.equal(gate.shouldReact(T0 + CELEBRATE_SUPPRESS_MS), true, 'only the next window boundary reacts');
});

test('the window span is injectable and both brief windows are locked', () => {
  const sip = createPetReactionGate(SIP_SUPPRESS_MS);
  assert.equal(sip.shouldReact(T0), true);
  assert.equal(sip.shouldReact(T0 + SIP_SUPPRESS_MS - 1), false);
  assert.equal(sip.shouldReact(T0 + SIP_SUPPRESS_MS), true);
  const tight = createPetReactionGate(5_000);
  assert.equal(tight.shouldReact(T0), true);
  assert.equal(tight.shouldReact(T0 + 4_999), false);
  assert.equal(tight.shouldReact(T0 + 5_000), true);
  assert.equal(CELEBRATE_SUPPRESS_MS, 30_000);
  assert.equal(SIP_SUPPRESS_MS, 10_000);
});

test('a clock running backwards is suppressed conservatively', () => {
  const gate = createPetReactionGate();
  assert.equal(gate.shouldReact(T0 + 40_000), true);
  assert.equal(gate.shouldReact(T0), false, 'now < lastAt must never react');
});
