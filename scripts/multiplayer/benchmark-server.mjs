// CPU/serialization benchmark, not a latency or network-capacity claim.
import { performance } from 'node:perf_hooks';
import { RaceService } from '../../server/rooms.js';
import { newDriver } from '../../src/multiplayer-physics.js';
import { createTrack } from '../../src/track.js';
import { packSnapshot } from '../../src/multiplayer-protocol.js';

for (const roomCount of [1, 5, 10]) {
  let now = 100000, nextCode = 100000;
  let encoded = new WeakMap(), wireBytes = 0;
  const service = new RaceService({ now: () => now, random: () => String(nextCode++), send: (_, message) => {
    let bytes = encoded.get(message);
    if (!bytes) { bytes = Buffer.byteLength(JSON.stringify(message.type === 'snapshot' ? packSnapshot(message) : message)); encoded.set(message, bytes); }
    wireBytes += bytes;
  } });
  const tracks = new Map();
  for (let r = 0; r < roomCount; r++) {
    let room;
    for (let p = 0; p < 12; p++) {
      const player = await service.identify({});
      if (!room) room = service.create(player, { nickname: `Driver ${p}` });
      else service.join(player, room, `Driver ${p}`);
      player.state = newDriver(['apex', 'rally', 'viper'][p % 3], p);
      player.seq = 1;
    }
    room.phase = 'racing'; room.raceId = `bench-${r}`; room.startAt = now; room.simTime = now;
    room.settings.laps = 10; tracks.set(room.code, createTrack(room.settings.trackId));
  }
  const timings = [], iterations = 1800, warmup = 300;
  wireBytes = 0;
  for (let i = 0; i < iterations + warmup; i++) {
    now += 1000 / 60;
    for (const room of service.rooms.values()) {
      const track = tracks.get(room.code);
      for (const player of service.listPlayers(room)) {
        const s = player.state;
        player.lastInput = now;
        player.input = { throttle: s.speed < 31, brake: s.speed > 33, steer: Math.max(-1, Math.min(1, track.sample(s.distance + 12).curvature * s.speed / 1.35 - s.lateral * .045 - s.heading * .9)) };
      }
    }
    const start = performance.now();
    service.tick();
    if (i % 3 === 0) { encoded = new WeakMap(); service.snapshots(); }
    if (i >= warmup) timings.push(performance.now() - start);
    if (i === warmup - 1) wireBytes = 0;
  }
  timings.sort((a, b) => a - b);
  const percentile = p => Number(timings[Math.floor((timings.length - 1) * p)].toFixed(3));
  console.log(JSON.stringify({ rooms: roomCount, players: roomCount * 12, tickBudgetMs: 16.667, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: timings.at(-1), meanMs: timings.reduce((a,b) => a+b,0)/timings.length, payloadMbitPerSecond: wireBytes * 8 / 30 / 1e6 }));
}
