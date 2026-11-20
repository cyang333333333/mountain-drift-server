import { angleDifference, stepDriver, stepRaceDrivers, EMPTY_INPUT } from './multiplayer-physics.js';
import { PROTOCOL, TICK_MS, unpackSnapshot, packInput, unpackInput } from './multiplayer-protocol.js';
import { SIMULATION_VERSION } from './multiplayer-version.js';
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const clone = state => ({ ...state, lapTimes: [...(state.lapTimes || [])] });
const zeroError = () => ({ distance: 0, lateral: 0, heading: 0 });

export class MultiplayerConnection extends EventTarget {
  constructor(url) {
    super(); Object.assign(this, { url, retry: 0, connected: false, closed: false, offset: 0, targetOffset: 0, ping: 0, pending: [], snapshots: [], seq: 0, clockSamples: [], interpolationDelay: 100, jitter: 0, lead: 45, correction: zeroError(), corrections: [], lastSend: -Infinity, lastCommandTick: 0 });
    this.origin = Date.now() - performance.now();
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  connect() {
    if (!this.url) { this.emit('error', 'The multiplayer server is not configured yet.'); return; }
    this.closed = false; this.socket = new WebSocket(this.url);
    this.socket.onopen = () => {
      let token; try { token = localStorage.getItem('mountain-drift-player-token-v1'); } catch {}
      this.send({ type: 'hello', token, protocol: PROTOCOL, simulation: SIMULATION_VERSION });
    };
    this.socket.onmessage = event => {
      const raw = JSON.parse(event.data), data = raw.type === 'snapshot' ? unpackSnapshot(raw) : raw;
      if (data.type === 'welcome') {
        if (data.protocol !== PROTOCOL || data.simulation !== SIMULATION_VERSION) {
          this.closed = true; this.emit('error', 'The server is updating. Refresh the page in a moment.'); this.socket.close(); return;
        }
        this.connected = true; this.retry = 0; this.id = data.id;
        try { localStorage.setItem('mountain-drift-player-token-v1', data.token); } catch {}
        this.emit('connected', data); this.pingServer();
        clearInterval(this.pinger); this.pinger = setInterval(() => this.pingServer(), 1000);
      } else if (data.type === 'pong') {
        const now = this.origin + performance.now(), rtt = Math.max(0, now - data.clientTime);
        this.clockSamples.push({ rtt, offset: data.serverTime - (data.clientTime + now) / 2 });
        if (this.clockSamples.length > 12) this.clockSamples.shift();
        const sorted = [...this.clockSamples].sort((a, b) => a.rtt - b.rtt);
        this.ping = Math.round(sorted[Math.floor(sorted.length / 2)].rtt);
        this.targetOffset = sorted[0].offset;
        if (this.clockSamples.length === 1) this.offset = this.targetOffset;
        this.lead += (clamp(this.ping / 2 + this.jitter + 30, 35, 180) - this.lead) * .15;
      } else if (data.type === 'snapshot') {
        if (!this.acceptSnapshot(data)) return;
      } else if (data.type === 'error' && /Refresh/.test(data.message)) {
        this.closed = true;
      } else if (data.type === 'replaced') { this.closed = true; this.socket.close(); }
      this.emit(data.type, data.type === 'error' ? data.message : data);
    };
    this.socket.onclose = () => {
      this.connected = false; clearInterval(this.pinger); this.lastSend = -Infinity; this.emit('disconnected', null);
      if (!this.closed) this.reconnector = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
    this.socket.onerror = () => this.emit('error', 'Connection interrupted. Reconnecting…');
  }
  now() {
    const stamp = performance.now(), elapsed = Math.max(0, stamp - (this.clockAt ?? stamp)); this.clockAt = stamp;
    this.offset += clamp(this.targetOffset - this.offset, -elapsed * .02, elapsed * .02);
    const now = this.origin + stamp + this.offset;
    this.previousNow = Math.max(this.previousNow ?? now, now); return this.previousNow;
  }
  acceptSnapshot(data) {
    const previous = this.snapshots.at(-1), changed = this.raceId !== data.raceId || previous?.timeline !== data.timeline;
    if (!changed && previous && data.tick < previous.tick) return false;
    const own = data.players.find(p => p.id === this.id), oldOwn = previous?.players.find(p => p.id === this.id);
    const reset = changed || (own && oldOwn && own.state.respawnAt !== oldOwn.state.respawnAt);
    const atTick = Math.max(this.lastPredictionTick || 0, data.tick);
    const before = !reset && this.track ? this.predictAt(this.track, atTick) : null;
    const arrival = performance.now();
    if (!changed && this.lastArrival != null && previous) {
      const variation = Math.abs((arrival - this.lastArrival) - (data.sentAt - previous.sentAt));
      this.jitter += (Math.min(200, variation) - this.jitter) * .1;
    }
    this.lastArrival = arrival;
    const delay = clamp(this.ping / 2 + 70 + this.jitter * 2, 90, 250);
    this.interpolationDelay += (delay - this.interpolationDelay) * .08;
    if (changed) {
      this.raceId = data.raceId; this.snapshots = []; this.pending = []; this.lastPredictionTick = data.tick;
      this.lastCommandTick = 0; this.lastSend = -Infinity; this.renderTime = null; this.renderClock = null;
    }
    this.snapshots.push(data); if (this.snapshots.length > 40) this.snapshots.shift();
    if (own) {
      this.seq = Math.max(this.seq, own.seq); this.pending = this.pending.filter(c => c.seq > own.seq);
      this.authoritative = clone(own.state);
    }
    if (reset) { this.correction = zeroError(); this.teleported = true; }
    else if (before && this.track && own) {
      const after = this.predictAt(this.track, atTick);
      if (after) {
        const error = { distance: before.distance - after.distance, lateral: before.lateral - after.lateral, heading: angleDifference(before.heading, after.heading) };
        this.corrections.push(Math.hypot(error.distance, error.lateral)); if (this.corrections.length > 1200) this.corrections.shift();
        if (Math.hypot(error.distance, error.lateral) > 15) { this.correction = zeroError(); this.teleported = true; }
        else for (const key of Object.keys(error)) this.correction[key] += error[key];
      }
    }
    return true;
  }
  close() { this.closed = true; clearTimeout(this.reconnector); clearInterval(this.pinger); if (this.socket?.readyState === 1) this.send({ type: 'leave' }); this.socket?.close(); }
  send(data) {
    if (this.socket?.readyState !== 1 || this.socket.bufferedAmount >= 4096) return false;
    this.socket.send(JSON.stringify(data)); return true;
  }
  pingServer() { this.send({ type: 'ping', clientTime: this.origin + performance.now(), ping: this.ping }); }
  input(raw, _unusedFrameDuration) {
    const snapshot = this.snapshots.at(-1); if (!snapshot || !['countdown','racing'].includes(snapshot.phase)) return false;
    // Quantize steering identically on both sides. Re-send held controls at 10 Hz;
    // changes are sent immediately, bounded to 60 Hz independently of render FPS.
    const input = unpackInput(packInput(raw)), stamp = performance.now();
    const dirty = JSON.stringify(input) !== JSON.stringify(this.lastInput);
    if (stamp - this.lastSend < (dirty ? 1000 / 60 : 100)) return false;
    const tick = Math.min(snapshot.tick + 120, Math.max(snapshot.tick + 1, this.lastCommandTick, Math.ceil((this.now() + this.lead - snapshot.startAt) / TICK_MS)));
    const command = { type: 'input', raceId: snapshot.raceId, seq: this.seq + 1, tick, input };
    if (!this.send(command)) return false;
    this.seq = command.seq; this.lastCommandTick = tick; this.lastSend = stamp; this.lastInput = input;
    this.pending.push(command); if (this.pending.length > 120) this.pending.shift();
    return true;
  }
  predictAt(track, requestedTick, all = false) {
    const snapshot = this.snapshots.at(-1), self = snapshot?.players.find(p => p.id === this.id);
    if (!self) return this.authoritative ? (all ? new Map([[this.id, clone(this.authoritative)]]) : clone(this.authoritative)) : null;
    if (snapshot.phase !== 'racing' || self.state.finished) return all ? new Map(snapshot.players.map(p => [p.id, clone(p.state)])) : clone(self.state);
    const target = clamp(requestedTick, snapshot.tick, snapshot.tick + 60), end = Math.ceil(target);
    const players = (snapshot.collisions ? snapshot.players : [self]).map(p => ({ id: p.id, state: clone(p.state), input: p.input || EMPTY_INPUT, commands: p.id === this.id ? this.pending : (p.commands || []), commandIndex: 0 }));
    const own = players.find(p => p.id === this.id); let prior;
    for (let tick = snapshot.tick + 1; tick <= end; tick++) {
      for (const p of players) while (p.commandIndex < p.commands.length && p.commands[p.commandIndex].tick <= tick) p.input = p.commands[p.commandIndex++].input;
      if (tick === end) prior = new Map(players.map(p => [p.id, clone(p.state)]));
      const time = snapshot.startAt + tick * TICK_MS;
      stepRaceDrivers(players, track, time, snapshot.collisions);
    }
    if (prior && target < end) {
      const alpha = target - Math.floor(target);
      for (const p of players) {
        const before = prior.get(p.id);
        for (const key of ['distance','lateral','speed','steer']) p.state[key] = before[key] + (p.state[key] - before[key]) * alpha;
        p.state.heading = before.heading + angleDifference(p.state.heading, before.heading) * alpha;
      }
    }
    return all ? new Map(players.map(p => [p.id, p.state])) : own.state;
  }
  predicted(track, all = false) {
    this.track = track;
    const snapshot = this.snapshots.at(-1); if (!snapshot) return null;
    const tick = clamp((this.now() + this.lead - snapshot.startAt) / TICK_MS, snapshot.tick, snapshot.tick + 60);
    this.lastPredictionTick = Math.max(this.lastPredictionTick ?? tick, tick);
    return this.predictAt(track, this.lastPredictionTick, all);
  }
  visualState(track, elapsed) {
    this.contactPlayers = this.predicted(track, true);
    const state = this.contactPlayers?.get(this.id); if (!state) return null;
    this.visualCorrection = { ...this.correction };
    const decay = Math.exp(-12 * Math.min(elapsed, .25));
    for (const key of Object.keys(this.correction)) { state[key] += this.correction[key]; this.correction[key] *= decay; }
    return state;
  }
  remoteTarget() {
    const now = this.now(), desired = now - this.interpolationDelay;
    if (this.renderTime == null) this.renderTime = desired;
    else {
      const elapsed = Math.max(0, now - this.renderClock), expected = this.renderTime + elapsed;
      // Adjust playback speed gently; growing the buffer never reverses time.
      this.renderTime = expected + clamp((desired - expected) * .05, -elapsed * .1, elapsed * .1);
    }
    this.renderClock = now; return this.renderTime;
  }
  remote(id, track) {
    const target = this.remoteTarget(); let a = this.snapshots[0], b = a;
    for (const snapshot of this.snapshots) { if (snapshot.serverTime <= target) a = snapshot; b = snapshot; if (snapshot.serverTime >= target) break; }
    const first = a?.players.find(p => p.id === id), last = b?.players.find(p => p.id === id);
    if (!first || !last) return last?.state || first?.state;
    if (first.state.respawnAt !== last.state.respawnAt) return clone(last.state);
    const state = clone(last.state);
    if (target > b.serverTime && !state.finished) {
      // Bridge brief gaps, then hold. Never speculate indefinitely through loss.
      let remaining = Math.min(125, target - b.serverTime) / 1000;
      while (remaining > .000001) {
        const dt = Math.min(1 / 120, remaining);
        if (track) stepDriver(state, last.input || EMPTY_INPUT, track, dt);
        else { state.distance += (Math.cos(state.heading) * state.speed + state.pushZ) * dt; state.lateral += (Math.sin(state.heading) * state.speed + state.pushX) * dt; }
        remaining -= dt;
      }
    } else {
      const alpha = clamp((target - a.serverTime) / Math.max(1, b.serverTime - a.serverTime), 0, 1);
      for (const key of ['distance','lateral','speed','steer']) state[key] = first.state[key] + (last.state[key] - first.state[key]) * alpha;
      state.heading = first.state.heading + angleDifference(last.state.heading, first.state.heading) * alpha;
    }
    return state;
  }
  contactVisual(id, remote, own, track) {
    const predicted = this.contactPlayers?.get(id);
    if (!remote || !predicted || own.finished || predicted.finished || !this.snapshots.at(-1)?.collisions) return remote;
    const delta = predicted.distance - own.distance;
    const gap = Math.hypot(delta - Math.round(delta / track.length) * track.length, predicted.lateral - own.lateral);
    const weight = clamp((80 - gap) / 40, 0, 1);
    if (!weight) return remote;
    const result = { ...predicted };
    for (const key of ['distance','lateral','speed','steer']) result[key] = remote[key] + (predicted[key] - remote[key]) * weight;
    result.heading = remote.heading + angleDifference(predicted.heading, remote.heading) * weight;
    // Apply the same visual correction to the nearby field, preserving contact.
    result.distance += (this.visualCorrection?.distance || 0) * weight;
    result.lateral += (this.visualCorrection?.lateral || 0) * weight;
    return result;
  }
  diagnostics() {
    const values = [...this.corrections].sort((a,b) => a-b);
    return { protocol: PROTOCOL, simulation: SIMULATION_VERSION, pending: this.pending.length, ping: this.ping, jitter: this.jitter, correctionP95: values[Math.floor(values.length * .95)] || 0, correctionMax: values.at(-1) || 0, correctionSamples: values.length, interpolationDelay: this.interpolationDelay };
  }
}
