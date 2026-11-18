import { randomBytes, createHash } from 'node:crypto';
import { createTrack } from '../src/track.js';
import { CARS, TRACKS, getTrack } from '../src/catalog.js';
import { newDriver, stepDriver, resolveContact, sanitizeInput, EMPTY_INPUT, FIXED_DT, contact } from '../src/multiplayer-physics.js';
import { snapshotState } from './snapshot-state.js';

export const EMOTES = ['Good luck!', 'Nice drift!', 'Clean racing!', 'Sorry!', 'Great race!', 'One more?'];
const tracks = new Map();
function trackFor(id) { if (!tracks.has(id)) tracks.set(id, createTrack(id)); return tracks.get(id); }
export function nickname(value) {
  const clean = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} _.-]{2,18}$/u.test(clean)) throw new Error('Enter a nickname with 2–18 letters, numbers, spaces, dots, dashes or underscores.');
  return clean;
}
const blankStats = () => ({ races: 0, wins: 0, podiums: 0, bestLaps: {} });
export class RaceService {
  constructor({ send = () => {}, saveStats = async () => {}, readStats = async () => blankStats(), now = () => Date.now(), random = () => randomBytes(4).toString('hex').slice(0, 6).toUpperCase() } = {}) {
    Object.assign(this, { send, saveStats, readStats, now, random }); this.rooms = new Map(); this.people = new Map(); this.finishJobs = new Set();
  }
  async identify(connection, token) {
    token = /^[a-f0-9]{64}$/.test(token || '') ? token : randomBytes(32).toString('hex');
    const id = createHash('sha256').update(token).digest('hex').slice(0, 32);
    let player = this.people.get(id);
    if (player?.connection && player.connection !== connection) this.send(player.connection, { type: 'replaced', message: 'This player connected in another tab.' });
    if (!player) {
      if (this.people.size >= 1000) throw new Error('The server is full. Try again shortly.');
      const stats = await this.readStats(id);
      player = { id, nickname: '', carId: 'apex', ready: false, loaded: false, ping: 0, room: null, state: null, input: EMPTY_INPUT, seq: -1, lastInput: 0, stats: stats || blankStats(), lastChat: 0, lastRespawn: 0, joined: this.now() };
      this.people.set(id, player);
    }
    player.connection = connection; player.disconnectedAt = null;
    if (player.state) { player.state.ghostUntil = this.now() + 3000; player.input = EMPTY_INPUT; }
    this.send(connection, { type: 'welcome', id, token, stats: player.stats });
    if (player.room) { this.broadcast(player.room); this.send(connection, this.snapshot(player.room)); }
    return player;
  }
  listPlayers(room) { return [...room.players].map(id => this.people.get(id)).filter(Boolean); }
  host(room) { if (!this.people.get(room.hostId)?.connection) room.hostId = this.listPlayers(room).find(p => p.connection)?.id || room.hostId; }
  roomInfo(room) {
    return { code: room.code, public: room.public, phase: room.phase, hostId: room.hostId, settings: room.settings,
      countdownAt: room.countdownAt, startAt: room.startAt, finishDeadline: room.finishDeadline, raceId: room.raceId,
      players: this.listPlayers(room).map(p => ({ id: p.id, nickname: p.nickname, carId: p.carId, ready: p.ready, loaded: p.loaded, ping: p.ping, connected: !!p.connection })), results: room.results };
  }
  broadcast(room) { this.host(room); const message = { type: 'room', room: this.roomInfo(room) }; for (const p of this.listPlayers(room)) if (p.connection) this.send(p.connection, message); }
  ensureRoom(player) { const room = this.rooms.get(player.room?.code); if (!room) throw new Error('Join a room first.'); return room; }
  create(player, data) {
    if (this.rooms.size >= 100) throw new Error('All rooms are busy. Try Quick Match.');
    let code; do { code = this.random(); } while (this.rooms.has(code));
    const room = { code, public: data.public === true, hostId: player.id, players: new Set(), phase: 'lobby', settings: { trackId: TRACKS[0].id, laps: 3, collisions: true, maxPlayers: 12 }, startAt: null, countdownAt: null, finishDeadline: null, results: [], raceId: null, simTime: null, events: [], created: this.now() };
    this.rooms.set(code, room); this.join(player, room, data.nickname); return room;
  }
  join(player, room, name) {
    name = nickname(name);
    if (room.phase !== 'lobby') throw new Error('This race has started. Reconnect with your existing player identity or join after it finishes.');
    if (room.players.size >= room.settings.maxPlayers && !room.players.has(player.id)) throw new Error('This room is full.');
    if (this.listPlayers(room).some(p => p.id !== player.id && p.nickname.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('That nickname is already taken in this room.');
    if (player.room && player.room !== room) this.leave(player);
    player.nickname = name; player.room = room; player.ready = false; player.loaded = false; player.state = null; room.players.add(player.id); this.broadcast(room);
  }
  leave(player) {
    const room = player.room; if (!room) return;
    room.players.delete(player.id); player.room = null; player.ready = false; player.state = null;
    if (!room.players.size) this.rooms.delete(room.code);
    else { if (room.hostId === player.id) room.hostId = this.listPlayers(room).find(p => p.connection)?.id || [...room.players][0]; this.broadcast(room); }
  }
  disconnect(player, connection) {
    if (!player || player.connection !== connection) return;
    player.connection = null; player.disconnectedAt = this.now(); player.input = EMPTY_INPUT; if (player.state) player.state.ghostUntil = this.now() + 31000;
    if (player.room) { this.host(player.room); this.broadcast(player.room); }
  }
  handle(player, data) {
    if (!player || player.connection == null) throw new Error('Connect first.');
    const now = this.now();
    if (data.type === 'ping') { player.ping = Math.max(0, Math.min(9999, Math.round(Number(data.ping) || 0))); if (player.room?.phase === 'lobby' && now - (player.room.pingBroadcast || 0) > 1500) { player.room.pingBroadcast = now; this.broadcast(player.room); } this.send(player.connection, { type: 'pong', clientTime: data.clientTime, serverTime: now }); return; }
    if (data.type === 'create' || data.type === 'quick') {
      nickname(data.nickname);
      if (player.room) throw new Error('Leave your current room first.');
      if (data.type === 'quick') {
        const available = [...this.rooms.values()].find(r => r.public && r.phase === 'lobby' && r.players.size < 12 && !this.listPlayers(r).some(p => p.nickname.toLocaleLowerCase() === nickname(data.nickname).toLocaleLowerCase()));
        if (available) { this.join(player, available, data.nickname); return; }
      }
      this.create(player, { ...data, public: data.type === 'quick' }); return;
    }
    if (data.type === 'join') { const room = this.rooms.get(String(data.code || '').trim().toUpperCase()); if (!room) throw new Error('Room not found. Check the invite code.'); this.join(player, room, data.nickname); return; }
    if (data.type === 'leave') { this.leave(player); this.send(player.connection, { type: 'left' }); return; }
    const room = this.ensureRoom(player);
    if (data.type === 'car') {
      if (room.phase !== 'lobby') throw new Error('Cars are locked until you return to the lobby.');
      if (!CARS.some(c => c.id === data.carId)) throw new Error('Choose one of the available cars.');
      player.carId = data.carId; player.ready = false; player.loaded = false; this.broadcast(room);
    } else if (data.type === 'settings') {
      if (room.hostId !== player.id || room.phase !== 'lobby') throw new Error('Only the lobby host can change settings.');
      if (room.public) throw new Error('Quick Match uses standard race settings.');
      const settings = data.settings || {};
      if (settings.trackId !== undefined && !TRACKS.some(t => t.id === settings.trackId)) throw new Error('Unknown track.');
      if (settings.laps !== undefined && (!Number.isInteger(settings.laps) || settings.laps < 1 || settings.laps > 10)) throw new Error('Choose 1–10 laps.');
      if (settings.maxPlayers !== undefined && (!Number.isInteger(settings.maxPlayers) || settings.maxPlayers < Math.max(2, room.players.size) || settings.maxPlayers > 12)) throw new Error('Choose a capacity from 2–12 that fits the lobby.');
      if (settings.collisions !== undefined && typeof settings.collisions !== 'boolean') throw new Error('Invalid collision setting.');
      for (const key of ['trackId', 'laps', 'collisions', 'maxPlayers']) if (key in settings) room.settings[key] = settings[key];
      for (const p of this.listPlayers(room)) { p.ready = false; p.loaded = false; } this.broadcast(room);
    } else if (data.type === 'ready') {
      if (room.phase !== 'lobby') return;
      player.ready = data.ready === true; this.broadcast(room);
    } else if (data.type === 'loaded') {
      if (room.phase !== 'preparing' || data.raceId !== room.raceId || data.trackId !== room.settings.trackId || data.carId !== player.carId) return;
      player.loaded = true;
      if (this.listPlayers(room).every(p => p.connection && p.loaded)) { room.phase = 'countdown'; room.countdownAt = now; room.startAt = now + 4000; room.simTime = room.startAt; }
      this.broadcast(room);
    } else if (data.type === 'start') {
      if (room.hostId !== player.id) throw new Error('Only the host can start the race.');
      const people = this.listPlayers(room);
      if (room.phase !== 'lobby' || people.length < 2 || !people.every(p => p.ready && p.connection)) throw new Error('At least two connected drivers must be ready.');
      room.phase = 'preparing'; room.raceId = randomBytes(12).toString('hex'); room.results = []; room.finishDeadline = null; room.preparingAt = now;
      people.forEach((p, i) => { p.state = newDriver(p.carId, i); p.loaded = false; p.seq = -1; p.appliedSeq = -1; p.input = EMPTY_INPUT; }); this.broadcast(room);
    } else if (data.type === 'input') {
      if (!['countdown', 'racing'].includes(room.phase) || !Number.isSafeInteger(data.seq) || data.seq <= player.seq) return;
      player.seq = data.seq; player.lastInput = now; player.input = sanitizeInput(data.input);
    } else if (data.type === 'respawn') {
      if (room.phase === 'racing' && !player.state.finished && now - player.lastRespawn > 5000) { player.lastRespawn = now; this.respawn(player, room, now); }
    } else if (data.type === 'chat') {
      if (!Number.isInteger(data.emote) || !EMOTES[data.emote] || now - player.lastChat < 3000) return;
      player.lastChat = now; for (const p of this.listPlayers(room)) if (p.connection) this.send(p.connection, { type: 'chat', id: player.id, message: EMOTES[data.emote] });
    } else if (data.type === 'lobby' || data.type === 'rematch') {
      if (room.phase !== 'results') throw new Error('Wait for the race to finish.');
      if (room.hostId !== player.id) throw new Error('The host chooses when to return everyone to the lobby.');
      room.phase = 'lobby'; room.startAt = null; room.countdownAt = null;
      for (const p of this.listPlayers(room)) { p.ready = false; p.loaded = false; p.state = null; }
      this.broadcast(room);
    }
  }
  respawn(player, room, now) {
    const s = player.state, track = trackFor(room.settings.trackId);
    s.distance = Math.max(0, s.checkpoint * track.length / 12); s.lateral = player.id.charCodeAt(0) % 2 ? 3 : -3;
    s.heading = 0; s.yaw = 0; s.pushX = 0; s.pushZ = 0; s.speed = 0; s.stuck = 0; s.ghostUntil = now + 3000; s.respawnAt = now; s.hitSerial++;
  }
  progress(player, room, from, now, dt) {
    const s = player.state, track = trackFor(room.settings.trackId), spacing = track.length / 12;
    // Progress can only pass ordered checkpoints in the forward direction.
    if (from <= 0 && s.distance > 0 && s.lapStarted == null) s.lapStarted = (now - room.startAt) / 1000;
    const next = (s.checkpoint + 1) * spacing;
    if (from < next && s.distance >= next && s.distance - from < 5) {
      s.checkpoint++; s.validDistance = next;
      if (s.checkpoint % 12 === 0) {
        const elapsed = (now - room.startAt) / 1000, lapTime = elapsed - (s.lapStarted ?? 0);
        s.lapTimes.push(lapTime); s.bestLap = Math.min(s.bestLap ?? Infinity, lapTime); s.lapStarted = elapsed;
        s.lap = Math.min(room.settings.laps, 1 + Math.floor(s.checkpoint / 12));
        if (s.checkpoint >= room.settings.laps * 12) {
          s.finished = true; s.finishTime = elapsed; player.input = EMPTY_INPUT;
          if (!room.finishDeadline) { room.finishDeadline = now + 30000; this.broadcast(room); }
        }
      }
    }
    if (s.distance > next + 5) { s.distance = from; s.speed = 0; } // Fail closed if a physics error jumps a gate.
    s.validDistance = Math.max(s.validDistance, Math.min(s.distance, next));
    if (s.speed < 1.5 && player.input.throttle) s.stuck += dt; else s.stuck = 0;
    if (s.stuck > 6) this.respawn(player, room, now);
  }
  tick(now = this.now()) {
    for (const room of [...this.rooms.values()]) {
      for (const p of this.listPlayers(room)) if (!p.connection && now - p.disconnectedAt > 30000) this.leave(p);
      if (!this.rooms.has(room.code)) continue;
      if (room.phase === 'preparing' && now - room.preparingAt > 60000) { room.phase = 'lobby'; for (const p of this.listPlayers(room)) { p.ready = false; p.loaded = false; } this.broadcast(room); }
      if (room.phase === 'countdown' && now >= room.startAt) {
        room.phase = 'racing'; for (const p of this.listPlayers(room)) p.state.ghostUntil = room.startAt + 3000; this.broadcast(room);
      }
      if (room.phase !== 'racing') continue;
      const people = this.listPlayers(room), track = trackFor(room.settings.trackId);
      // Bound catch-up to avoid a spiral after a server stall; pause race time rather than awarding unplayed distance.
      if (now - room.simTime > 250) {
        const lost = now - room.simTime - 250; room.startAt += lost; if (room.finishDeadline) room.finishDeadline += lost; room.simTime += lost;
      }
      // Never make solid cars overlap as start/respawn protection expires.
      for (const p of people) if (p.state?.ghostUntil > 0 && p.state.ghostUntil <= now) {
        if (room.settings.collisions && people.some(other => other !== p && other.state && !other.state.finished && contact(p.state, other.state, track.length))) p.state.ghostUntil = now + 200;
        else p.state.ghostUntil = 0;
      }
      while (room.simTime + FIXED_DT * 1000 <= now) {
        room.simTime += FIXED_DT * 1000;
        const before = new Map();
        for (const p of people) {
          if (!p.state || p.state.finished) continue;
          before.set(p.id, p.state.distance);
          stepDriver(p.state, p.connection && now - p.lastInput < 500 ? p.input : EMPTY_INPUT, track);
          p.appliedSeq = p.seq;
        }
        if (room.settings.collisions) {
          for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
            const a = people[i].state, b = people[j].state;
            if (!a || !b || a.finished || b.finished || a.ghostUntil > room.simTime || b.ghostUntil > room.simTime) continue;
            const force = resolveContact(a, b, track.length);
            if (force > 2) room.events.push({ id: `${room.raceId}:${Math.round(room.simTime)}:${i}:${j}`, a: people[i].id, b: people[j].id, force: Math.min(1, force / 22), distance: a.distance, lateral: a.lateral });
          }
        }
        for (const p of people) if (before.has(p.id) && !p.state.finished) this.progress(p, room, before.get(p.id), room.simTime, FIXED_DT);
      }
      if (people.length && (people.every(p => p.state?.finished || !p.connection) || (room.finishDeadline && now >= room.finishDeadline))) this.finish(room);
    }
    for (const [id, p] of this.people) if (!p.connection && !p.room && now - (p.disconnectedAt || p.joined) > 60000) this.people.delete(id);
  }
  snapshot(room) {
    return { type: 'snapshot', serverTime: this.now(), raceId: room.raceId, phase: room.phase, startAt: room.startAt, finishDeadline: room.finishDeadline,
      players: this.listPlayers(room).filter(p => p.state).map(p => ({ id: p.id, seq: room.phase === 'countdown' ? p.seq : (p.appliedSeq ?? -1), state: snapshotState(p.state) })), events: room.events.slice(-30) };
  }
  snapshots() { for (const room of this.rooms.values()) if (['countdown', 'racing'].includes(room.phase)) { const snapshot = this.snapshot(room); for (const p of this.listPlayers(room)) if (p.connection) this.send(p.connection, snapshot); room.events = []; } }
  finish(room) {
    if (room.phase === 'results') return;
    room.phase = 'results';
    const people = this.listPlayers(room).sort((a, b) => (a.state.finishTime ?? Infinity) - (b.state.finishTime ?? Infinity) || b.state.validDistance - a.state.validDistance);
    room.results = people.map((p, index) => ({ id: p.id, nickname: p.nickname, carId: p.carId, place: index + 1, time: p.state.finishTime, bestLap: p.state.bestLap, laps: p.state.lapTimes.length, dnf: !p.state.finished }));
    for (let index = 0; index < people.length; index++) {
      const p = people[index], s = p.stats, key = `${room.settings.trackId}:${room.settings.collisions ? 'contact' : 'ghost'}`;
      s.races++; if (p.state.finished && index === 0) s.wins++; if (p.state.finished && index < 3) s.podiums++;
      if (p.state.bestLap && (!s.bestLaps[key] || p.state.bestLap < s.bestLaps[key])) s.bestLaps[key] = p.state.bestLap;
      const job = Promise.resolve(this.saveStats(p.id, s, room.raceId)).then(() => { if (p.connection) this.send(p.connection, { type: 'stats', stats: s }); }).catch(() => { if (p.connection) this.send(p.connection, { type: 'error', message: 'Race finished, but stats could not be saved. They will retry on the next race.' }); }).finally(() => this.finishJobs.delete(job)); this.finishJobs.add(job);
    }
    this.broadcast(room);
  }
}
