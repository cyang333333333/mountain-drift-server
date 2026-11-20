import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARS, TRACKS } from '../src/catalog.js';
import { createTrack } from '../src/track.js';
import { ROAD_HALF, VERGE_HALF } from '../src/road.js';
import { freshRace, stepRace } from '../src/race.js';
import { BODY, newDriver, contact, resolveContact, stepDriver, FIXED_DT } from '../src/multiplayer-physics.js';


const throttle = { throttle: true, steer: 0 };
for (const car of CARS) test(`${car.shortName}: faster pace and boost match in singleplayer and multiplayer`, () => {
  const single = freshRace(car.id), multi = newDriver(car.id);
  const track = { length: 100000, sample: () => ({ curvature: 0 }) };
  for (let i = 0; i < 1200; i++) { stepRace(single, throttle, 0, track.length, FIXED_DT); stepDriver(multi, throttle, track); }
  const prior = { apex: 88, rally: 82, viper: 98 }[car.id];
  assert.ok(Math.abs(single.speed / prior - 1.65) < .00001, 'straight-line speed is 65% higher than the previous update');
  assert.ok(Math.abs(single.speed - multi.speed) < 1e-9);
  for (let i = 0; i < 180; i++) { stepRace(single, { ...throttle, boost: true }, 0, track.length, FIXED_DT); stepDriver(multi, { ...throttle, boost: true }, track); }
  assert.ok(single.speed > car.maxSpeed);
  assert.ok(Math.abs(single.speed - multi.speed) < 1e-9);
});

for (const config of TRACKS) test(`${config.name}: scenery cuttings clear all lanes, shoulders, and verge`, () => {
  const track = createTrack(config.id);
  for (let i = 0; i < 240; i++) {
    const p = track.sample(i / 240 * track.length);
    for (let lateral = -VERGE_HALF; lateral <= VERGE_HALF; lateral += 2) {
      const x = p.x + p.nx * lateral, z = p.z + p.nz * lateral;
      assert.ok(track.sceneryHeight(x, z, 500) < p.y - 1);
      assert.ok(track.terrainHeight(x, z) < p.y - .5);
      assert.equal(track.sceneryFits(x, z, 100), false);
    }
  }
});

test('bumpers and sides contact at the visible edge and a head-on impact separates firmly', () => {
  for (const aId of Object.keys(BODY)) for (const bId of Object.keys(BODY)) {
    const a = newDriver(aId), b = newDriver(bId);
    a.distance = b.distance = 0; a.lateral = b.lateral = 0;
    const reach = (BODY[aId].length + BODY[bId].length) / 2;
    b.distance = reach + .17; assert.equal(contact(a, b, 10000), null);
    b.distance = reach + .1; assert.ok(contact(a, b, 10000), 'bumpers contact before visible penetration');
    b.distance = 0; b.lateral = (BODY[aId].width + BODY[bId].width) / 2 + .1;
    assert.ok(contact(a, b, 10000), 'side panels contact before visible penetration');
  }
  const a = newDriver('apex'), b = newDriver('apex');
  Object.assign(a, { distance: 0, lateral: 0, speed: 100 }); Object.assign(b, { distance: 11.4, lateral: 0, speed: 100, heading: Math.PI });
  assert.ok(resolveContact(a, b, 10000) > 190);
  assert.ok(a.speed + a.pushZ < 0 && -b.speed + b.pushZ > 0, 'both vehicles rebound');
  assert.ok(contact(a, b, 10000).depth < .002, 'less than 2mm residual penetration');
});

test('inside-lane collision detection uses the same body positions as rendering, including the lap seam', () => {
  const track = createTrack();
  let distance = 0;
  for (let i = 0; i < 1200; i++) if (track.sample(i / 1200 * track.length).curvature > track.sample(distance).curvature) distance = i / 1200 * track.length;
  const a = newDriver('viper'), b = newDriver('viper');
  Object.assign(a, { distance, lateral: ROAD_HALF - BODY.viper.width / 2 });
  Object.assign(b, { distance: distance + BODY.viper.length + 1, lateral: a.lateral });
  assert.equal(contact(a, b, track.length), null, 'old centerline approximation misses the touch');
  assert.ok(contact(a, b, track.length, track), 'physical inside-lane bodies touch');
  a.distance = track.length - 5; b.distance = 5;
  a.lateral = b.lateral = 0;
  assert.ok(contact(a, b, track.length, track), 'lap wrap has no gap in contact');
});

