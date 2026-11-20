export const TRACKS = [
  { id: 'alpine-pass-v1', name: 'Alpine Pass', theme: 'alpine', label: 'THE MOUNTAIN', subtitle: 'Pine forests. Snowy peaks. Golden corners.', difficulty: 'FLOWING · 3 LAPS', seed: 7129,
    points: [[-120,14,90],[-155,18,15],[-130,30,-85],[-55,43,-145],[25,45,-130],[65,37,-65],[130,27,-50],[180,21,15],[150,16,110],[70,10,165],[-10,11,145],[-65,15,110]] },
  { id: 'ember-run-v1', name: 'Ember Run', theme: 'volcano', label: 'THE VOLCANO', subtitle: 'Black rock. Lava seas. A different kind of heat.', difficulty: 'TECHNICAL · 3 LAPS', seed: 42271,
    points: [[-145,26,95],[-175,32,5],[-125,45,-110],[-35,60,-165],[55,53,-130],[100,34,-55],[175,27,-5],[190,32,95],[105,44,165],[10,42,125],[-65,30,165]] }
];

export const CARS = [
  { id: 'apex', name: 'Audi A7 Prestige', shortName: 'Audi A7', year: 2013, kind: '2013 · PRESTIGE', description: 'Brilliant black. A sweeping fastback, chrome details, and a balanced drive.', color: '#080b0e', swatch: '#b1bbc4', model: 'a7', stats: [4, 4, 4], acceleration: 56.1, maxSpeed: 145.2, boostSpeed: 184.8, turn: 1.35, grip: 1.2, driftTurn: 1.2 },
  { id: 'rally', name: 'BMW M4 Competition', shortName: 'BMW M4', year: 2027, kind: '2027 · COMPETITION', description: 'Dark graphite. Sculpted arches, a carbon roof, and a sharper line.', color: '#24282d', swatch: '#b0b9c2', model: 'm4', stats: [3, 5, 3], acceleration: 62.7, maxSpeed: 135.3, boostSpeed: 173.25, turn: 1.5, grip: 1.5, driftTurn: 1.08 },
  { id: 'viper', name: 'Mercedes-Maybach S-Class', shortName: 'Maybach S-Class', year: 2027, kind: '2027 · TWO-TONE', description: 'Obsidian black over silver. A long silhouette and polished Maybach wheels.', color: '#88939f', upperColor: '#080b0e', swatch: '#d1d8de', model: 'maybach', stats: [5, 3, 5], acceleration: 51.15, maxSpeed: 161.7, boostSpeed: 204.6, turn: 1.22, grip: 1.03, driftTurn: 1.3 }
];
export const getTrack = id => TRACKS.find(track => track.id === id) || TRACKS[0];
export const getCar = id => CARS.find(car => car.id === id) || CARS[0];
const SETTINGS = 'mountain-drift-garage-v1';
export function readSelection() {
  try { const value = JSON.parse(localStorage.getItem(SETTINGS) || '{}'); return { carId: getCar(value.carId).id, trackId: getTrack(value.trackId).id }; }
  catch { return { carId: CARS[0].id, trackId: TRACKS[0].id }; }
}
export function saveSelection(value) { try { localStorage.setItem(SETTINGS, JSON.stringify(value)); } catch { /* Device storage is optional. */ } }
