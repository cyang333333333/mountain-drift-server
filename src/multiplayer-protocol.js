import { newDriver, sanitizeInput } from './multiplayer-physics.js';
export const PROTOCOL = 2;
export const TICK_MS = 1000 / 120;
// Numeric arrays remove repeated field names without compressing the socket or
// changing the precision used by authoritative physics.
const fields = ['distance','lateral','heading','steer','speed','boost','yaw','pushX','pushZ','hit','impact','hitSerial','lap','checkpoint','validDistance','finishTime','bestLap','lapStarted','ghostUntil','respawnAt','stuck'];
export function packInput(raw) {
  const i = sanitizeInput(raw);
  return [(i.throttle ? 1 : 0) | (i.brake ? 2 : 0) | (i.drift ? 4 : 0) | (i.boost ? 8 : 0), Math.round(i.steer * 10000) / 10000];
}
export function unpackInput([flags = 0, steer = 0] = []) {
  return { throttle: !!(flags & 1), brake: !!(flags & 2), drift: !!(flags & 4), boost: !!(flags & 8), steer };
}
export function packSnapshot(snapshot) {
  return { ...snapshot, packed: true, players: snapshot.players.map(p => {
    const s = p.state, flags = (s.finished ? 1 : 0) | (s.drift ? 2 : 0) | (s.boosting ? 4 : 0) | (s.braking ? 8 : 0) | (s.wrongWay ? 16 : 0);
    return [p.id, p.seq, s.carId, flags, ...fields.map(k => s[k]), s.lapTimes, packInput(p.input), (p.commands || []).map(c => [c.seq,c.tick,packInput(c.input)])];
  }) };
}
export function unpackSnapshot(snapshot) {
  if (!snapshot.packed) return snapshot;
  return { ...snapshot, packed: false, players: snapshot.players.map(row => {
    const [id, seq, carId, flags] = row, state = newDriver(carId);
    fields.forEach((key, i) => { state[key] = row[4 + i]; });
    Object.assign(state, { finished: !!(flags & 1), drift: !!(flags & 2), boosting: !!(flags & 4), braking: !!(flags & 8), wrongWay: !!(flags & 16), lapTimes: row[4 + fields.length] });
    return { id, seq, state, input: unpackInput(row[5 + fields.length]), commands: (row[6 + fields.length] || []).map(([seq,tick,input]) => ({ seq,tick,input:unpackInput(input) })) };
  }) };
}
