// World units match the enlarged vehicle bodies (roughly 5 units wide).
// Shared by the renderer, singleplayer and the authoritative multiplayer server.
export const ROAD = Object.freeze({
  lanesPerSide: 4, laneWidth: 6.5, medianHalf: 1.2,
  shoulderWidth: 2.8, vergeWidth: 2.2, routeScale: 2
});
export const CARRIAGEWAY_HALF = ROAD.medianHalf + ROAD.lanesPerSide * ROAD.laneWidth;
export const ROAD_HALF = CARRIAGEWAY_HALF + ROAD.shoulderWidth;
export const VERGE_HALF = ROAD_HALF + ROAD.vergeWidth;
export const BARRIER_OFFSET = ROAD_HALF + .65;
export const laneCenter = (side, lane) => side * (ROAD.medianHalf + (lane + .5) * ROAD.laneWidth);
// Old narrow-circuit times stay stored, but do not compete with the longer layout.
export const roadRecordKey = trackId => `${trackId}-eight-lane-v1`;
// Four wide columns, with a spare lane between adjacent starters.
export const GRID_LATERALS = Object.freeze([-laneCenter(1, 2), -laneCenter(1, 0), laneCenter(1, 0), laneCenter(1, 2)]);
export function roadBodyLimit(width, length, heading = 0) {
  return Math.max(.3, ROAD_HALF - (width * Math.abs(Math.cos(heading)) + length * Math.abs(Math.sin(heading))) / 2);
}
