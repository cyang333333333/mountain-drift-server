import { getCar } from './catalog.js';
import { clamp, damp } from './race.js';

export const FIXED_DT = 1 / 120;
export const BODY = Object.freeze({
  apex: { mass: 1900, width: 5.04, length: 11.43 },
  rally: { mass: 1750, width: 5.04, length: 11.8 },
  viper: { mass: 2400, width: 5.04, length: 13.05 }
});
export const EMPTY_INPUT = Object.freeze({ throttle: false, brake: false, steer: 0, drift: false, boost: false });
export const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function sanitizeInput(value) {
  return { throttle: value?.throttle === true, brake: value?.brake === true, steer: clamp(Number(value?.steer) || 0, -1, 1), drift: value?.drift === true, boost: value?.boost === true };
}
export function newDriver(carId, grid = 0) {
  return { carId: getCar(carId).id, distance: -8 - Math.floor(grid / 2) * 16, lateral: grid % 2 ? 3.1 : -3.1,
    heading: 0, steer: 0, speed: 0, boost: 100, yaw: 0, pushX: 0, pushZ: 0, hit: 0, impact: 0, hitSerial: 0,
    drift: false, boosting: false, braking: false, lap: 1, finished: false, finishTime: null,
    checkpoint: 0, validDistance: 0, lapTimes: [], bestLap: null, lapStarted: null, ghostUntil: 0,
    respawnAt: -100, stuck: 0, wrongWay: false, lastProgress: 0 };
}
export function bodyLimit(s) {
  const b = BODY[s.carId];
  return Math.max(.25, 7 - (Math.abs(Math.cos(s.heading)) * b.width + Math.abs(Math.sin(s.heading)) * b.length) / 2);
}
function impact(s, force) {
  s.impact = clamp(force / 22, 0, 1); s.hit = .5; s.hitSerial++;
}
export function stepDriver(s, rawInput, track, dt = FIXED_DT) {
  if (s.finished) return;
  const input = sanitizeInput(rawInput), car = getCar(s.carId), road = track.sample(s.distance);
  s.hit = Math.max(0, s.hit - dt); s.impact = Math.max(0, s.impact - dt * 2);
  s.steer = damp(s.steer, input.steer, 7, dt);
  s.drift = input.drift && Math.abs(s.steer) > .12 && s.speed > 10;
  s.boosting = input.boost && !input.brake && s.speed > 3 && s.boost > 1;
  s.braking = input.brake;
  s.boost = clamp(s.boost + (s.boosting ? -28 : s.drift ? 17 : 5) * dt, 0, 100);
  const acceleration = (input.throttle ? car.acceleration : 0) + (s.boosting ? 25 : 0) - (input.brake ? 34 : 0);
  s.speed = clamp(s.speed + (acceleration - 1 - s.speed * .11 - s.speed ** 2 * .0018 - (s.drift ? 3 : 0)) * dt, 0, s.boosting ? car.boostSpeed : car.maxSpeed);
  const turn = s.steer * car.turn * clamp(s.speed / 16, 0, 1) * (s.drift ? car.driftTurn : 1);
  s.heading += (turn - road.curvature * s.speed - s.heading * (s.drift ? .45 : car.grip) + s.yaw) * dt;
  // Preserve spins while letting grip gently bring the car back toward the road.
  s.heading = angleDifference(s.heading, 0); s.yaw *= Math.exp(-2.2 * dt);
  s.pushX *= Math.exp(-2.6 * dt); s.pushZ *= Math.exp(-2.6 * dt);
  s.lateral += (Math.sin(s.heading) * s.speed + s.pushX) * dt;
  s.distance += (Math.cos(s.heading) * s.speed + s.pushZ) * dt;
  const limit = bodyLimit(s);
  if (Math.abs(s.lateral) > limit) {
    const speed = Math.abs(Math.sin(s.heading) * s.speed + s.pushX);
    s.lateral = Math.sign(s.lateral) * limit;
    s.pushX = -s.pushX * .15;
    if (!s.hit) { s.speed *= .6; impact(s, speed); s.yaw *= .4; }
    s.heading = damp(s.heading, -Math.sign(s.lateral) * .12, 4, dt);
  }
  s.wrongWay = Math.cos(s.heading) < -.15 && s.speed > 3;
}

function axes(s) { return [{ x: Math.cos(s.heading), z: -Math.sin(s.heading) }, { x: Math.sin(s.heading), z: Math.cos(s.heading) }]; }
function radius(s, axis) {
  const b = BODY[s.carId], [side, forward] = axes(s);
  return Math.abs(side.x * axis.x + side.z * axis.z) * b.width / 2 + Math.abs(forward.x * axis.x + forward.z * axis.z) * b.length / 2;
}
function distanceBetween(a, b, length) { const delta = b.distance - a.distance; return delta - Math.round(delta / length) * length; }
export function contact(a, b, length) {
  const delta = { x: b.lateral - a.lateral, z: distanceBetween(a, b, length) };
  if (Math.abs(delta.z) > 17 || Math.abs(delta.x) > 15) return null;
  let depth = Infinity, normal;
  for (const axis of [...axes(a), ...axes(b)]) {
    const projection = delta.x * axis.x + delta.z * axis.z;
    const overlap = radius(a, axis) + radius(b, axis) - Math.abs(projection);
    if (overlap <= 0) return null;
    if (overlap < depth) { depth = overlap; normal = { x: axis.x * (projection >= 0 ? 1 : -1), z: axis.z * (projection >= 0 ? 1 : -1) }; }
  }
  return { depth, normal, delta };
}
export function resolveContact(a, b, length) {
  const hit = contact(a, b, length); if (!hit) return 0;
  const { normal: n, depth, delta } = hit, ba = BODY[a.carId], bb = BODY[b.carId], ia = 1 / ba.mass, ib = 1 / bb.mass;
  const correction = Math.max(0, depth - .005) / (ia + ib) * .85;
  a.lateral -= n.x * correction * ia; a.distance -= n.z * correction * ia;
  b.lateral += n.x * correction * ib; b.distance += n.z * correction * ib;
  const va = { x: Math.sin(a.heading) * a.speed + a.pushX, z: Math.cos(a.heading) * a.speed + a.pushZ };
  const vb = { x: Math.sin(b.heading) * b.speed + b.pushX, z: Math.cos(b.heading) * b.speed + b.pushZ };
  const relative = (vb.x - va.x) * n.x + (vb.z - va.z) * n.z;
  if (relative >= 0) return 0;
  // Contact point offset supplies angular momentum for glancing impacts.
  const ra = { x: clamp(delta.x / 2, -ba.width / 2, ba.width / 2), z: clamp(delta.z / 2, -ba.length / 2, ba.length / 2) };
  const rb = { x: -ra.x, z: -ra.z };
  const ca = ra.z * n.x - ra.x * n.z, cb = rb.z * n.x - rb.x * n.z;
  const inertiaA = ba.mass * (ba.width ** 2 + ba.length ** 2) / 12, inertiaB = bb.mass * (bb.width ** 2 + bb.length ** 2) / 12;
  const impulse = -(1.12 * relative) / (ia + ib + ca ** 2 / inertiaA + cb ** 2 / inertiaB);
  a.pushX -= impulse * n.x * ia; a.pushZ -= impulse * n.z * ia;
  b.pushX += impulse * n.x * ib; b.pushZ += impulse * n.z * ib;
  a.yaw = clamp(a.yaw - ca * impulse / inertiaA, -5, 5); b.yaw = clamp(b.yaw + cb * impulse / inertiaB, -5, 5);
  if (-relative > 1.5 && !a.hit) impact(a, -relative);
  if (-relative > 1.5 && !b.hit) impact(b, -relative);
  return -relative;
}
export function stepDrivers(players, track, elapsed, time, collisions) {
  const count = Math.ceil(elapsed / FIXED_DT), dt = elapsed / count;
  for (let step = 0; step < count; step++) {
    for (const p of players) stepDriver(p.state, p.input, track, dt);
    if (collisions) for (let iteration = 0; iteration < 3; iteration++) {
      for (let a = 0; a < players.length; a++) for (let b = a + 1; b < players.length; b++) {
        const x = players[a].state, y = players[b].state;
        if (!x.finished && !y.finished && time >= x.ghostUntil && time >= y.ghostUntil) resolveContact(x, y, track.length);
      }
    }
  }
}
