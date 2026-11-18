import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotState } from '../server/snapshot-state.js';
import { newDriver } from '../src/multiplayer-physics.js';

test('compact snapshots preserve fields, full precision physics, and submillimeter accuracy', () => {
  const state = { ...newDriver('apex'), distance: 123.123456789, heading: -.123456789, speed: 31.123456789, lapTimes: [34.123456789], ghostUntil: 1795020000000 };
  const before = structuredClone(state), wire = snapshotState(state);
  assert.deepEqual(state, before);
  assert.deepEqual(Object.keys(wire), Object.keys(state));
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'number') assert.ok(Math.abs(wire[key] - value) <= .000051, key);
  }
  assert.equal(wire.ghostUntil, state.ghostUntil);
  assert.ok(Math.abs(wire.lapTimes[0] - state.lapTimes[0]) <= .000051);
  wire.lapTimes.push(99);
  assert.equal(state.lapTimes.length, 1);
  assert.ok(JSON.stringify(wire).length < JSON.stringify(state).length);
});
