# Mountain Drift multiplayer server

Authoritative multiplayer racing backend, extracted from the game source.

Requires Node.js 22 or newer. Run `npm ci --omit=dev --ignore-scripts`.
Set `PORT`, `PORT_BASE`, and `PORT_END` to the assigned port and allowed range.
Set `MP_ORIGINS` to comma-separated exact frontend origins and `MP_STATS_FILE`
to a persistent JSON file outside this repository. Keep deployment settings in
an environment file outside the repository; do not commit credentials or stats.
Run `node --env-file=/path/to/runtime.env server/index.js` through the hosting
service manager. Bind is plain HTTP on 0.0.0.0; the host proxy owns HTTPS and CORS.
The proxy must support WebSocket upgrades at `/ws`. Readiness is at `/health`.
Use `MP_TRUST_PROXY=loopback` only when the proxy connects from loopback and
supplies a single trusted client IP in X-Forwarded-For. Untrusted proxy chains
fall back to peer-address limits. This is a single-process room authority.

`npm test` checks snapshot precision and proxy address handling. `npm run benchmark`
reports synthetic CPU/serialization cost, not real network capacity or latency.
Simulation runs at 120 Hz; snapshots at 20 Hz. Snapshot values use four decimal
places on the wire; server physics and race results retain full precision.
Client prediction and interpolation remain implemented in the frontend.

Stats persist separately from releases. Back up that file off the host.
Restarts preserve saved stats but end active races. No player bearer tokens,
private SSH keys, hosting credentials, or runtime records belong in this repo.

## Tick protocol and synchronization

Protocol 2 schedules controls on bounded 120 Hz simulation ticks. Acknowledgments
refer to commands applied to physics, not merely received. Snapshots include their
simulation tick, held controls and upcoming accepted commands. Numeric arrays
reduce wire size; shared collision stepping keeps prediction consistent.
Clients and servers must deploy the same generated multiplayer-version.js hash
and shared simulation files. Stale versions are refused with a refresh message.

Run `npm test` for jitter, low-frame-rate, backpressure, collision, interpolation
and packing regressions. `MP_TEST_URL=wss://HOST/ws node tests/multiplayer-smoothness.mjs --jitter`
checks real WebSocket traffic with ordered delay and 120 ms rendering stalls.
Tests use synthetic driver names and never contain deployment credentials.
