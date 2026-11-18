import * as THREE from 'three';
import { getTrack } from './catalog.js';
import { ROAD, VERGE_HALF } from './road.js';

export function noise(x, z) { return Math.sin(x * .043) * Math.cos(z * .037) * 4 + Math.sin(x * .091 + z * .027) * 2 + Math.cos(x * .018 - z * .052) * 3; }

export function zoneWeight(progress, start, end) {
  return THREE.MathUtils.smoothstep(progress, start, start + .035) * (1 - THREE.MathUtils.smoothstep(progress, end - .035, end));
}

export function createTrack(trackId = 'alpine-pass-v1') {
  const config = getTrack(trackId);
  // Broader bend radii leave every inside lane open on the widened roads.
  const curve = new THREE.CatmullRomCurve3(config.points.map(([x, y, z]) => new THREE.Vector3(x * ROAD.routeScale, y, z * ROAD.routeScale)), true, 'centripetal');
  curve.arcLengthDivisions = 2400;
  const length = curve.getLength(), count = 1200;
  const points = curve.getSpacedPoints(count);
  const headings = points.map((p, i) => {
    const next = points[(i + 1) % count], prev = points[(i + count - 1) % count];
    return Math.atan2(next.x - prev.x, next.z - prev.z);
  });
  function sample(distance) {
    const t = ((distance % length) + length) % length / length * count;
    const i = Math.floor(t), f = t - i, a = points[i], b = points[(i + 1) % count];
    const angle = headings[i] + Math.atan2(Math.sin(headings[(i + 1) % count] - headings[i]), Math.cos(headings[(i + 1) % count] - headings[i])) * f;
    const prev = headings[(i + count - 2) % count], next = headings[(i + 2) % count];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f,
      angle, nx: Math.cos(angle), nz: -Math.sin(angle), curvature: Math.atan2(Math.sin(next - prev), Math.cos(next - prev)) / (4 * length / count) };
  }
  const coarse = points.filter((_, i) => i % 6 === 0);
  function nearest(x, z) {
    let best = Infinity, closest = 0;
    for (let i = 0; i < coarse.length; i++) { const p = coarse[i], d = (x - p.x) ** 2 + (z - p.z) ** 2; if (d < best) { best = d; closest = i * 6; } }
    best = Infinity;
    let height = 0, progress = 0;
    for (let j = closest - 7; j <= closest + 7; j++) {
      const i = (j + count) % count, a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const f = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const d = (x - a.x - dx * f) ** 2 + (z - a.z - dz * f) ** 2;
      if (d < best) { best = d; height = a.y + (b.y - a.y) * f; progress = (i + f) / count; }
    }
    return { distance: Math.sqrt(best), height, progress };
  }
  function terrainHeight(x, z) {
    const near = nearest(x, z);
    const rough = noise(x, z);
    const hills = config.theme === 'volcano'
      ? 5 + rough * 1.1 + Math.sin(x * .012 + .6) * Math.cos(z * .014) * 15
      : 19 + rough * 1.5 + Math.sin(x * .009) * Math.cos(z * .011) * 25;
    const mix = THREE.MathUtils.smoothstep(near.distance, VERGE_HALF + 7, VERGE_HALF + 45);
    let height = THREE.MathUtils.lerp(near.height - 1.2, hills, mix);
    if (config.theme === 'volcano') {
      // Road clearance is measured against the entire circuit, including bends.
      const canyon = zoneWeight(near.progress, .015, .245);
      height += canyon * 39 * THREE.MathUtils.smoothstep(near.distance, VERGE_HALF + 7, VERGE_HALF + 25) * (1 - THREE.MathUtils.smoothstep(near.distance, VERGE_HALF + 50, VERGE_HALF + 100));
      const crossing = zoneWeight(near.progress, .49, .735);
      height = THREE.MathUtils.lerp(height, -9 + rough * .3, crossing);
      const climb = zoneWeight(near.progress, .245, .455);
      height += climb * 23 * THREE.MathUtils.smoothstep(near.distance, VERGE_HALF + 9, VERGE_HALF + 40) * (1 - THREE.MathUtils.smoothstep(near.distance, VERGE_HALF + 65, VERGE_HALF + 120));
    }
    return height;
  }
  return { ...config, curve, length, points, sample, nearest, terrainHeight };
}

