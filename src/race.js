import { getCar } from './catalog.js';
import { ROAD_HALF } from './road.js';
export { ROAD_HALF } from './road.js';
export const LAPS = 3;
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--.--';
  const cs = Math.floor(seconds * 100);
  return `${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

export function freshRace(carId = 'apex') {
  return { carId: getCar(carId).id, distance: 0, lateral: 0, heading: 0, steer: 0, speed: 0, boost: 100, time: 0,
    score: 0, combo: 0, comboTime: 0, drift: false, boosting: false, hit: 0, hits: 0, finished: false, lap: 1 };
}

// Interpolate only visual values; scoring, collisions, and timing use the fixed state.
export function interpolateRace(previous, current, alpha) {
  const result = { ...current }, t = clamp(alpha, 0, 1);
  for (const key of ['distance', 'lateral', 'heading', 'steer', 'speed']) {
    result[key] = previous[key] + (current[key] - previous[key]) * t;
  }
  return result;
}

// Fixed road coordinates prevent skipping a corner or triggering a lap backwards.
// Everything uses seconds and meters, independent of display refresh rate.
export function stepRace(s, input, curvature, length, dt, lateralLimit = ROAD_HALF - 1) {
  if (s.finished) return;
  const car = getCar(s.carId);
  s.time += dt;
  s.hit = Math.max(0, s.hit - dt);
  s.steer = damp(s.steer, input.steer, 7, dt);
  s.drift = Boolean(input.drift && Math.abs(s.steer) > .12 && s.speed > 10);
  s.boosting = Boolean(input.boost && !input.brake && s.speed > 3 && s.boost > 1);
  s.boost = clamp(s.boost + (s.boosting ? -28 : s.drift ? 17 : 5) * dt, 0, 100);
  const acceleration = (input.throttle ? car.acceleration : 0) + (s.boosting ? 40 : 0) - (input.brake ? 55 : 0);
  s.speed = clamp(s.speed + (acceleration - 1 - s.speed * .11 - s.speed * s.speed * .0014 - (s.drift ? 3 : 0)) * dt, 0, s.boosting ? car.boostSpeed : car.maxSpeed);
  const turn = s.steer * car.turn * clamp(s.speed / 16, 0, 1) * (s.drift ? car.driftTurn : 1);
  s.heading = clamp(s.heading + (turn - curvature * s.speed - s.heading * (s.drift ? .45 : car.grip)) * dt, -1.12, 1.12);
  s.lateral += Math.sin(s.heading) * s.speed * dt;
  s.distance = Math.min(length * LAPS, s.distance + Math.cos(s.heading) * s.speed * dt);
  if (Math.abs(s.lateral) > lateralLimit) {
    s.lateral = Math.sign(s.lateral) * lateralLimit;
    s.heading = -Math.sign(s.lateral) * .12;
    if (!s.hit) { s.speed *= .6; s.hit = .65; s.hits++; s.combo = 0; s.comboTime = 0; }
  }
  if (s.drift && !s.hit) { s.combo += s.speed * Math.abs(s.steer) * dt * 5; s.comboTime = 1.25; }
  else if (s.comboTime > 0) {
    s.comboTime -= dt;
    if (s.comboTime <= 0) { s.score += Math.round(s.combo); s.combo = 0; }
  }
  s.lap = Math.min(LAPS, Math.floor(s.distance / length) + 1);
  if (s.distance >= length * LAPS) {
    s.score += Math.round(s.combo); s.combo = 0; s.finished = true; s.drift = false; s.boosting = false;
  }
}
