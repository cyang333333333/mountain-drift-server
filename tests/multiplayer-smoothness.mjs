// Real WebSocket traffic with optional ordered jitter and main-thread stalls.
import WS from 'ws';
import assert from 'node:assert/strict';
import { MultiplayerConnection } from '../src/multiplayer-net.js';
import { createTrack } from '../src/track.js';
import { getCar } from '../src/catalog.js';
const url=process.env.MP_TEST_URL||'ws://127.0.0.1:8788/ws', jitter=process.argv.includes('--jitter');
const Original=globalThis.WebSocket,clients=[],timers=new Set(),gaps=[],sizes=[],backward=[];let arrival;
class TestSocket {
  constructor(url){this.ws=new WS(url,{origin:'http://127.0.0.1:5173'});this.queued=0;this.receiveAt=0;this.sendAt=0;this.messages=0;this.sends=0;
    this.ws.on('open',()=>this.onopen?.({}));this.ws.on('close',()=>this.onclose?.({}));this.ws.on('error',e=>this.onerror?.(e));
    this.ws.on('message',bytes=>{const delay=jitter?[5,12,65,5,100,8][this.messages++%6]:0;const due=Math.max(this.receiveAt,performance.now()+delay);this.receiveAt=due;
      this.schedule(()=>{const raw=bytes.toString();if(JSON.parse(raw).type==='snapshot'){const now=performance.now();if(arrival!=null)gaps.push(now-arrival);arrival=now;sizes.push(bytes.length);}this.onmessage?.({data:raw});},due-performance.now());});
  }
  schedule(fn,ms){const timer=setTimeout(()=>{timers.delete(timer);fn();},Math.max(0,ms));timers.add(timer);}
  get readyState(){return this.ws.readyState;}get bufferedAmount(){return this.ws.bufferedAmount+this.queued;}
  send(raw){if(!jitter||JSON.parse(raw).type==='leave'){this.ws.send(raw);return;}const due=Math.max(this.sendAt,performance.now()+[8,12,45,10][this.sends++%4]);this.sendAt=due;this.queued+=raw.length;this.schedule(()=>{this.queued-=raw.length;if(this.ws.readyState===1)this.ws.send(raw);},due-performance.now());}
  close(){this.ws.close();}
}
globalThis.WebSocket=TestSocket;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+20000;while(!fn()){if(Date.now()>end)throw Error('Timed out waiting for room');await wait(20);}}
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return Number((sorted[Math.floor((sorted.length-1)*p)]||0).toFixed(4));};
let render,stall,previous;
try{
  for(let i=0;i<2;i++){
    const c=new MultiplayerConnection(url);clients.push(c);c.addEventListener('room',ev=>c.room=ev.detail.room);c.connect();await until(()=>c.connected);
    c.send(i?{type:'join',code:clients[0].room.code,nickname:'Smooth Two'}:{type:'create',nickname:'Smooth One'});await until(()=>c.room);
  }
  const host=clients[0];host.send({type:'settings',settings:{collisions:false,laps:1}});await wait(400);
  for(const c of clients)c.send({type:'ready',ready:true});await until(()=>host.room.players.every(p=>p.ready));host.send({type:'start'});await until(()=>host.room.phase==='preparing');
  for(const c of clients)c.send({type:'loaded',raceId:host.room.raceId,trackId:host.room.settings.trackId,carId:'apex'});await until(()=>host.room.phase==='racing');
  const track=createTrack(host.room.settings.trackId);
  render=setInterval(()=>{for(const c of clients){const s=c.predicted(track);if(!s)continue;const car=getCar(s.carId),steer=Math.max(-1,Math.min(1,track.sample(s.distance+12).curvature*s.speed/car.turn-s.lateral*.045-s.heading*.9));c.input({throttle:s.speed<31,brake:s.speed>33,steer});const visual=c.visualState(track,1/60);if(c===host){if(previous&&visual.respawnAt===previous.respawnAt&&visual.distance<previous.distance)backward.push(previous.distance-visual.distance);previous=visual;}}},1000/60);
  if(jitter)stall=setInterval(()=>{const until=performance.now()+120;while(performance.now()<until){}},2000);
  await wait(3000);for(const c of clients)c.corrections=[];backward.length=0;gaps.length=0;sizes.length=0;
  await wait(10000);
  const result={jitter,renderStallMs:jitter?120:0,pingMs:host.ping,samples:host.corrections.length,correctionP95:percentile(host.corrections,.95),correctionMax:percentile(host.corrections,1),backwardVisualMax:percentile(backward,1),snapshotBytesMedian:percentile(sizes,.5),arrivalGapP95:percentile(gaps,.95)};
  console.log(JSON.stringify(result));
  assert.ok(result.samples>=100);
  assert.ok(result.correctionP95<(jitter?.35:.08),'prediction correction p95 must stay small');
  assert.ok(result.backwardVisualMax<.5,'display must not jump backwards');
}finally{clearInterval(render);clearInterval(stall);for(const c of clients)c.close();for(const timer of timers)clearTimeout(timer);globalThis.WebSocket=Original;}
