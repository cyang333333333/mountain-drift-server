import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerConnection } from '../src/multiplayer-net.js';
import { RaceService } from '../server/rooms.js';
import { newDriver } from '../src/multiplayer-physics.js';
import { createTrack } from '../src/track.js';
import { TICK_MS, packSnapshot, unpackSnapshot } from '../src/multiplayer-protocol.js';

async function fixture(collisions = false) {
  let now = 100000;
  const service = new RaceService({ now: () => now }), a = await service.identify({}), b = await service.identify({});
  const room = service.create(a, { nickname: 'Driver One' }); service.join(b, room, 'Driver Two');
  Object.assign(room, { phase: 'racing', raceId: 'race', tick: 0, timeline: 0, startAt: now, simTime: now }); room.settings.collisions = collisions;
  for (const [i,p] of [a,b].entries()) Object.assign(p, { state: { ...newDriver('apex'), distance: 10 + i * 100, lateral: 0, speed: 30, ghostUntil: 0 }, inputQueue: [], appliedSeq: -1 });
  const c = new MultiplayerConnection('test'); c.id = a.id; c.now = () => now; c.lead = 90;
  const track = createTrack(room.settings.trackId); c.track = track; c.acceptSnapshot(service.snapshot(room));
  return { service, a, b, room, c, track, get now(){return now;}, advance(tick) { now = room.startAt + tick * TICK_MS; service.tick(); } };
}

test('bundled commands apply and acknowledge on their scheduled ticks, without trusting client dt', async () => {
  const h = await fixture();
  for (const [seq,tick] of [[1,4],[2,8],[3,12]]) h.service.handle(h.a,{type:'input',seq,tick,input:{throttle:true},dt:10000});
  h.advance(3); assert.equal(h.a.appliedSeq,-1);
  h.advance(4); assert.equal(h.a.appliedSeq,1);
  h.advance(8); assert.equal(h.a.appliedSeq,2);
  h.advance(12); assert.equal(h.a.appliedSeq,3);
  assert.ok(h.a.state.distance<15,'client duration cannot advance extra distance');
});

test('prediction stays aligned through jitter, bundled delivery, and 15–144 Hz rendering', async () => {
  for (const fps of [15,30,60,144]) {
    const h = await fixture(), uplink = [], downlink = []; let frameAt=0, samples=0;
    h.c.socket={readyState:1,bufferedAmount:0,send:raw=>uplink.push({at:h.now+10+(samples++%4)*12,data:JSON.parse(raw)})};
    for(let tick=1;tick<=960;tick++) {
      h.advance(tick);
      for(let i=uplink.length-1;i>=0;i--) if(uplink[i].at<=h.now){h.service.handle(h.a,uplink[i].data);uplink.splice(i,1);}
      if(tick%6===0)downlink.push({at:h.now+8+(tick%5)*11,data:unpackSnapshot(packSnapshot(h.service.snapshot(h.room)))});
      while(downlink.length&&downlink[0].at<=h.now)h.c.acceptSnapshot(downlink.shift().data);
      if(tick*TICK_MS>=frameAt){h.c.lastSend=-Infinity;h.c.input({throttle:true,steer:Math.max(-1,Math.min(1,h.track.sample(h.a.state.distance+12).curvature*h.a.state.speed/1.35-h.a.state.lateral*.045-h.a.state.heading*.9))});h.c.visualState(h.track,1/fps);frameAt+=1000/fps;}
    }
    assert.ok(h.c.corrections.length>100);
    assert.ok(Math.max(...h.c.corrections)<.025,`${fps} Hz max correction: ${Math.max(...h.c.corrections)}`);
  }
});

test('blocked socket sends do not add phantom input history or advance sequence', async()=>{
  const h=await fixture();h.c.socket={readyState:1,bufferedAmount:8192,send(){throw Error('must not send');}};
  assert.equal(h.c.input({throttle:true}),false);assert.equal(h.c.pending.length,0);assert.equal(h.c.seq,0);
});

test('prediction includes server-equivalent car collisions at the same tick',async()=>{
  const h=await fixture(true);
  Object.assign(h.a.state,{distance:10,speed:40});Object.assign(h.b.state,{distance:20,speed:5});
  h.c.acceptSnapshot(h.service.snapshot(h.room));
  const prediction=h.c.predictAt(h.track,2);h.advance(2);
  assert.ok(h.a.state.hitSerial>0,'test exercises a real car impact');
  for(const key of ['distance','lateral','speed','yaw','pushX','pushZ'])assert.ok(Math.abs(prediction[key]-h.a.state[key])<.0002,key);
});

test('opponents bridge short snapshot gaps but stop after bounded extrapolation',()=>{
  const c=new MultiplayerConnection('');let now=1000;c.now=()=>now;c.interpolationDelay=100;
  c.snapshots=[{serverTime:800,players:[{id:'other',input:{throttle:true},state:{...newDriver('apex'),distance:10,speed:20}}]},{serverTime:850,players:[{id:'other',input:{throttle:true},state:{...newDriver('apex'),distance:11,speed:20}}]}];
  const first=c.remote('other').distance;now+=50;const later=c.remote('other').distance;assert.ok(later>first);
  now+=1000;const capped=c.remote('other').distance;now+=1000;assert.equal(c.remote('other').distance,capped);assert.ok(capped<=13.501);
});

test('growing the interpolation buffer cannot reverse playback time',()=>{
  const c=new MultiplayerConnection('');let now=1000;c.now=()=>now;c.interpolationDelay=100;
  let previous=c.remoteTarget();c.interpolationDelay=250;
  for(let i=0;i<60;i++){now+=1000/60;const next=c.remoteTarget();assert.ok(next>=previous);previous=next;}
});

test('visual smoothing damps correction error without damping normal movement', async()=>{
  const h=await fixture();h.c.lead=0;h.c.correction.distance=2;
  const start=h.c.visualState(h.track,1/60);h.advance(2);const predicted=h.c.predicted(h.track),visual=h.c.visualState(h.track,1/60);
  assert.ok(Math.abs((visual.distance-predicted.distance)-2*Math.exp(-12/60))<.00001);
  assert.ok(start.distance>h.a.state.distance);
  h.c.correction={distance:0,lateral:0,heading:0};assert.equal(h.c.visualState(h.track,1/60).distance,h.c.predicted(h.track).distance);
});

test('snapshot packing keeps prediction fields and cuts full-room payload by at least 40%',async()=>{
  const h=await fixture();for(let i=2;i<12;i++){const p=await h.service.identify({});h.room.players.add(p.id);p.room=h.room;p.state=newDriver('apex',i);}
  const original=h.service.snapshot(h.room),packed=packSnapshot(original),decoded=unpackSnapshot(packed);
  assert.ok(JSON.stringify(packed).length<JSON.stringify(original).length*.6);
  for(let i=0;i<12;i++)for(const key of ['distance','lapTimes','finished','carId','ghostUntil','hitSerial'])assert.deepEqual(decoded.players[i].state[key],original.players[i].state[key]);
});

test('nearby opponents render at the collision prediction time instead of behind their physical bodies', async () => {
  const h = await fixture(true);
  Object.assign(h.a.state, { distance: 20, speed: 70, lateral: 0 });
  Object.assign(h.b.state, { distance: 32, speed: 20, lateral: 0 });
  h.c.acceptSnapshot(h.service.snapshot(h.room));
  h.c.correction.distance = 1;
  const own = h.c.visualState(h.track, 1 / 60), predicted = h.c.contactPlayers.get(h.b.id);
  const remote = { ...predicted, distance: predicted.distance - 8 };
  const shown = h.c.contactVisual(h.b.id, remote, own, h.track);
  assert.ok(Math.abs(shown.distance - predicted.distance - h.c.visualCorrection.distance) < .00001);
  assert.equal(shown.lateral, predicted.lateral);
  assert.ok(shown.distance > remote.distance + 7, 'visible opponent follows contact time rather than delayed interpolation');
  const far = { ...predicted, distance: own.distance + 200 };
  h.c.contactPlayers.set(h.b.id, far);
  assert.equal(h.c.contactVisual(h.b.id, remote, own, h.track), remote, 'distant cars retain buffered interpolation');
});
