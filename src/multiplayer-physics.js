import { getCar } from './catalog.js';
import { clamp, damp } from './race.js';
import { GRID_LATERALS, roadBodyLimit } from './road.js';

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
  return { carId: getCar(carId).id, distance: -8 - Math.floor(grid / GRID_LATERALS.length) * 20, lateral: GRID_LATERALS[grid % GRID_LATERALS.length],
    heading: 0, steer: 0, speed: 0, boost: 100, yaw: 0, pushX: 0, pushZ: 0, hit: 0, impact: 0, hitSerial: 0,
    drift: false, boosting: false, braking: false, lap: 1, finished: false, finishTime: null,
    checkpoint: 0, validDistance: 0, lapTimes: [], bestLap: null, lapStarted: null, ghostUntil: 0,
    respawnAt: -100, stuck: 0, wrongWay: false, lastProgress: 0 };
}
export function bodyLimit(s) {
  const b = BODY[s.carId];
  return roadBodyLimit(b.width, b.length, s.heading);
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
  const acceleration = (input.throttle ? car.acceleration : 0) + (s.boosting ? 66 : 0) - (input.brake ? 90.75 : 0);
  s.speed = clamp(s.speed + (acceleration - 1.65 - s.speed * .11 - s.speed ** 2 * (.0014 / 1.65) - (s.drift ? 4.95 : 0)) * dt, 0, s.boosting ? car.boostSpeed : car.maxSpeed);
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

const CONTACT_SKIN = .08;
function axes(s, rotation = 0) { const h = s.heading + rotation; return [{ x: Math.cos(h), z: -Math.sin(h) }, { x: Math.sin(h), z: Math.cos(h) }]; }
function rotate(v, angle) { return { x: v.x * Math.cos(angle) + v.z * Math.sin(angle), z: -v.x * Math.sin(angle) + v.z * Math.cos(angle) }; }
function radius(s, axis, rotation) {
  const b = BODY[s.carId], [side, forward] = axes(s, rotation);
  return Math.abs(side.x * axis.x + side.z * axis.z) * (b.width / 2 + CONTACT_SKIN) + Math.abs(forward.x * axis.x + forward.z * axis.z) * (b.length / 2 + CONTACT_SKIN);
}
function distanceBetween(a, b, length) { const delta = b.distance - a.distance; return delta - Math.round(delta / length) * length; }
export function contact(a, b, length, track) {
  const gap = distanceBetween(a, b, length);
  if (Math.abs(gap) > 35 || Math.abs(b.lateral - a.lateral) > 20) return null;
  let delta = { x: b.lateral - a.lateral, z: gap }, rotation = 0, scaleA = 1, scaleB = 1;
  if (track && Number.isFinite(track.sample(a.distance).angle)) {
    const pa = track.sample(a.distance), pb = track.sample(b.distance);
    rotation = angleDifference(pb.angle, pa.angle);
    scaleA = Math.max(.2, 1 - pa.curvature * a.lateral); scaleB = Math.max(.2, 1 - pb.curvature * b.lateral);
    // Compare the rendered body locations; centerline distance alone is wrong
    // on inside lanes, where the physical distance is substantially shorter.
    delta = rotate({ x: pb.x + pb.nx * b.lateral - pa.x - pa.nx * a.lateral, z: pb.z + pb.nz * b.lateral - pa.z - pa.nz * a.lateral }, -pa.angle);
  }
  let depth = Infinity, normal;
  for (const axis of [...axes(a), ...axes(b, rotation)]) {
    const projection = delta.x * axis.x + delta.z * axis.z;
    const overlap = radius(a, axis, 0) + radius(b, axis, rotation) - Math.abs(projection);
    if (overlap <= 0) return null;
    if (overlap < depth) { depth = overlap; normal = { x: axis.x * (projection >= 0 ? 1 : -1), z: axis.z * (projection >= 0 ? 1 : -1) }; }
  }
  return { depth, normal, delta, rotation, scaleA, scaleB };
}
export function resolveContact(a, b, length, track) {
  const hit = contact(a, b, length, track); if (!hit) return 0;
  const { normal: n, depth, delta, rotation, scaleA, scaleB } = hit, ba = BODY[a.carId], bb = BODY[b.carId], ia = 1 / ba.mass, ib = 1 / bb.mass;
  const nb = rotate(n, -rotation);
  const correction = Math.max(0, depth - .001) / (ia + ib);
  a.lateral -= n.x * correction * ia; a.distance -= n.z * correction * ia / scaleA;
  b.lateral += nb.x * correction * ib; b.distance += nb.z * correction * ib / scaleB;
  const va = { x: Math.sin(a.heading) * a.speed + a.pushX, z: (Math.cos(a.heading) * a.speed + a.pushZ) * scaleA };
  const vb = rotate({ x: Math.sin(b.heading) * b.speed + b.pushX, z: (Math.cos(b.heading) * b.speed + b.pushZ) * scaleB }, rotation);
  const relative = (vb.x - va.x) * n.x + (vb.z - va.z) * n.z;
  if (relative >= 0) return 0;
  // Contact point offset supplies angular momentum for glancing impacts.
  const offset = (state, body, rotation, sign) => {
    const [side, forward] = axes(state, rotation);
    const x = clamp(sign * (delta.x * side.x + delta.z * side.z) / 2, -body.width / 2, body.width / 2);
    const z = clamp(sign * (delta.x * forward.x + delta.z * forward.z) / 2, -body.length / 2, body.length / 2);
    return { x: side.x * x + forward.x * z, z: side.z * x + forward.z * z };
  };
  const ra = offset(a, ba, 0, 1), rb = offset(b, bb, rotation, -1);
  const ca = ra.z * n.x - ra.x * n.z, cb = rb.z * n.x - rb.x * n.z;
  const inertiaA = ba.mass * (ba.width ** 2 + ba.length ** 2) / 12, inertiaB = bb.mass * (bb.width ** 2 + bb.length ** 2) / 12;
  const impulse = -(1.38 * relative) / (ia + ib + ca ** 2 / inertiaA + cb ** 2 / inertiaB);
  a.pushX -= impulse * n.x * ia; a.pushZ -= impulse * n.z * ia / scaleA;
  b.pushX += impulse * nb.x * ib; b.pushZ += impulse * nb.z * ib / scaleB;
  a.yaw = clamp(a.yaw - ca * impulse / inertiaA, -5, 5); b.yaw = clamp(b.yaw + cb * impulse / inertiaB, -5, 5);
  if (-relative > 1.5 && !a.hit) impact(a, -relative);
  if (-relative > 1.5 && !b.hit) impact(b, -relative);
  return -relative;
}
// Identical fixed-step ordering for authoritative racing and client prediction.
export function stepRaceDrivers(players, track, time, collisions, onImpact) {
  for (const p of players) if (p.state.ghostUntil > 0 && p.state.ghostUntil <= time) {
    p.state.ghostUntil = collisions && players.some(other => other !== p && !other.state.finished && contact(p.state, other.state, track.length, track)) ? time + 200 : 0;
  }
  for (const p of players) if (!p.state.finished) stepDriver(p.state, p.input, track);
  if (collisions) for (let iteration = 0; iteration < 3; iteration++) for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i].state, b = players[j].state;
    if (a.finished || b.finished || a.ghostUntil > time || b.ghostUntil > time) continue;
    const force = resolveContact(a, b, track.length, track);
    if (force > 2) onImpact?.(i, j, force);
  }
}
export function stepDrivers(players, track, elapsed, time, collisions) {
  const count = Math.ceil(elapsed / FIXED_DT), dt = elapsed / count;
  for (let step = 0; step < count; step++) {
    for (const p of players) stepDriver(p.state, p.input, track, dt);
    if (collisions) for (let iteration = 0; iteration < 3; iteration++) {
      for (let a = 0; a < players.length; a++) for (let b = a + 1; b < players.length; b++) {
        const x = players[a].state, y = players[b].state;
        if (!x.finished && !y.finished && time >= x.ghostUntil && time >= y.ghostUntil) resolveContact(x, y, track.length, track);
      }
    }
  }
}
