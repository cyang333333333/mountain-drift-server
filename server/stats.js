import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
export async function createStatsStore() {
  if (process.env.STATS_MODE === 'firestore') {
    // Cloud Run supplies a short-lived service identity through its metadata endpoint.
    // No service-account key or browser permission to write these records is needed.
    const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'website1-ea730';
    const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/multiplayerStats/`;
    let credential;
    async function headers() {
      if (!credential || credential.expires < Date.now() + 60000) {
        const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Server identity unavailable');
        const token = await response.json(); credential = { token: token.access_token, expires: Date.now() + token.expires_in * 1000 };
      }
      return { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json' };
    }
    return {
      read: async id => {
        const response = await fetch(base + id, { headers: await headers(), signal: AbortSignal.timeout(10000) });
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error('Stats service unavailable');
        const record = await response.json(); return JSON.parse(record.fields.stats.stringValue);
      },
      save: async (id, stats, raceId) => {
        const response = await fetch(base + id, { method: 'PATCH', headers: await headers(), body: JSON.stringify({ fields: { stats: { stringValue: JSON.stringify(stats) }, raceId: { stringValue: raceId }, updatedAt: { timestampValue: new Date().toISOString() } } }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Stats could not be saved');
      }
    };
  }
  const filename = resolve(process.env.MP_STATS_FILE || '.multiplayer-data/stats.json');
  let entries = {}; try { entries = JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let queue = Promise.resolve();
  return {
    read: async id => entries[id]?.stats,
    save: (id, stats, raceId) => {
      entries[id] = { stats: structuredClone(stats), raceId };
      queue = queue.catch(() => {}).then(async () => { await mkdir(dirname(filename), { recursive: true }); await writeFile(filename + '.tmp', JSON.stringify(entries)); await rename(filename + '.tmp', filename); });
      return queue;
    }
  };
}
