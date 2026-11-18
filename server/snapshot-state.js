// Keep authoritative physics at full precision. Four decimal places on the
// wire resolve position to 0.1 mm and avoid sending long floating-point tails.
const compactNumber = value => Number.isFinite(value) && !Number.isInteger(value) ? Math.round(value * 10000) / 10000 : value;
export function snapshotState(state) {
  const copy = {};
  for (const [key, value] of Object.entries(state)) {
    copy[key] = typeof value === 'number' ? compactNumber(value) : Array.isArray(value) ? value.map(compactNumber) : value;
  }
  return copy;
}
