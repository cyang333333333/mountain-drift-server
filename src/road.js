// World units match the enlarged vehicle bodies (roughly 5 units wide).
// Shared by the renderer, singleplayer and the authoritative multiplayer server.
export const ROAD = Object.freeze({
  lanesPerSide: 3, laneWidth: 6.5, medianHalf: 1.2,
  shoulderWidth: 2.8, vergeWidth: 2.2, routeScale: 2
});
export const CARRIAGEWAY_HALF = ROAD.medianHalf + ROAD.lanesPerSide * ROAD.laneWidth;
export const ROAD_HALF = CARRIAGEWAY_HALF + ROAD.shoulderWidth;
export const VERGE_HALF = ROAD_HALF + ROAD.vergeWidth;
export const BARRIER_OFFSET = ROAD_HALF + .65;
export const laneCenter = (side, lane) => side * (ROAD.medianHalf + (lane + .5) * ROAD.laneWidth);
// Earlier layout times stay stored separately from the faster six-lane circuit.
export const roadRecordKey = trackId => `${trackId}-six-lane-v1`;
// Four starting columns fit the inner and outer lanes on each side.
export const GRID_LATERALS = Object.freeze([-laneCenter(1, 2), -laneCenter(1, 0), laneCenter(1, 0), laneCenter(1, 2)]);
export function roadBodyLimit(width, length, heading = 0) {
  return Math.max(.3, ROAD_HALF - (width * Math.abs(Math.cos(heading)) + length * Math.abs(Math.sin(heading))) / 2);
}
