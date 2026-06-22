# NPM Traffic Control

**Real-time npm registry traffic monitor** — every time a package is published or updated, a semi-truck drives it toward you on a perspective highway and passes through the "NPM REGISTRY ENTRY POINT" toll booth.

## How it works

There's a giant warehouse called **npm** where people keep code packages. Every time someone puts a new package on the shelf or updates an existing one, a bell rings.

This app listens for that bell, checks how big the package is (tiny like a marble or huge like a refrigerator), and draws a color-coded truck driving toward you on screen.

1. **Server** (`server.ts`) polls npm's CouchDB changes feed (`replicate.npmjs.com/_changes`) every 3 seconds asking "any new packages?". When a change is found, it fetches the package's size from its metadata.

2. **Sorting** — each package is categorized by its unpacked size: **tiny** (<50KB), **small** (<200KB), **medium** (<1MB), **large** (<5MB), **big** (<20MB), or **huge** (20MB+). Each category has a distinct color and affects the truck's size and speed.

3. **Broadcast** — the package info is pushed over a WebSocket to every connected browser.

4. **Visualization** — the browser renders a real 3D scene with **Three.js / WebGL**: a PBR-lit semi-truck spawns at the horizon and drives down a perspective night highway straight toward you, headlights blooming and spilling light onto the asphalt, wheels rolling, until it passes under the gantry. Lighting, shadows, reflections, and bloom post-processing make it as close to photoreal as a real-time browser renderer gets.

5. **Arrival** — when the truck passes through the toll booth sign that reads **"NPM REGISTRY ENTRY POINT"**, the package has officially arrived at the registry.

## Controls

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Mute / unmute the horns | 🔊 button | <kbd>M</kbd> |
| Pause / resume the traffic | ⏸ button | <kbd>Space</kbd> |
| Hide the HUD (cinematic view) | — | <kbd>H</kbd> |
| Open a package on npmjs.com | click a truck / log row | — |

Your mute choice is remembered across visits. Pausing freezes the highway while the live counters keep ticking, so it doubles as a "hold this frame" button.

## Live telemetry

The HUD is now a real monitor, not just a counter:

- **Rate** — packages arriving per minute (rolling 60-second window), with the all-time **peak** shown bottom-left next to **uptime**.
- **Connection badge** — reflects the actual link state: `CONNECTING` → `LIVE`, `FEED LAG` when npm's feed stalls but the server is healthy, and `RECONNECTING` / `OFFLINE` if the socket drops. Reconnects use exponential backoff and keep your session log intact (no more full-page reloads).
- **Cumulative totals** persist to `stats.json` on the server, so the odometer survives restarts.

The server also exposes a `GET /healthz` JSON endpoint (status, rate, uptime, connected clients, feed health) for uptime checks.

Prefers-reduced-motion is respected (horns default to muted, bloom is softened), and the renderer automatically drops to a lighter quality if a machine can't hold frame rate.

## Running it

```bash
bun run start
```

Open `http://localhost:3000` in a browser. Trucks will start rolling in as packages are published to npm in real-time.

### Configuration (optional)

All via environment variables:

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP / WebSocket port |
| `POLL_MS` | `3000` | how often to poll npm's changes feed |
| `HEARTBEAT_MS` | `5000` | how often the server pushes a telemetry tick |
| `STATS_FILE` | `./stats.json` | where cumulative totals are persisted |

## Tech

- **Bun** — backend server (HTTP + WebSocket)
- **Three.js / WebGL** — real-time 3D rendering: highway, PBR semi-trucks, toll-booth gantry, lighting, shadows, and bloom post-processing (vendored under `public/vendor/three` so it runs offline)
- **npm registry APIs** — `replicate.npmjs.com/_changes` for live updates, `registry.npmjs.org/{name}/latest` for package sizes
