import type { ServerWebSocket } from "bun";

const PORT = Number(process.env.PORT) || 3000;
const POLL_MS = Number(process.env.POLL_MS) || 3000;
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 5000;
const STATS_FILE = process.env.STATS_FILE || "./stats.json";

const clients = new Set<ServerWebSocket<unknown>>();
let lastSeq: number | string = 0;

// ---------------------------------------------------------------- Metrics state
type Stats = { tiny: number; small: number; medium: number; large: number; big: number; huge: number };
let stats: Stats = { tiny: 0, small: 0, medium: 0, large: 0, big: 0, huge: 0 };
let totalPkgs = 0;
let peakRate = 0;                 // highest packages-per-minute ever observed
const startTime = Date.now();
const arrivals: number[] = [];    // arrival timestamps (ms) within the rolling window
const RATE_WINDOW_MS = 60_000;    // rate = packages seen in the last 60s
const recentPkgs: any[] = [];
const MAX_RECENT = 50;

// ---------------------------------------------------------------- Feed health
let feedOk = false;               // is the npm changes feed reachable?
let pollFails = 0;
let lastPollAt = 0;               // last successful poll (ms)

const SIZES = [
  { label: "tiny", max: 50_000, color: "#10b981", speed: 1.8 },
  { label: "small", max: 200_000, color: "#06b6d4", speed: 1.5 },
  { label: "medium", max: 1_000_000, color: "#f59e0b", speed: 1.2 },
  { label: "large", max: 5_000_000, color: "#f97316", speed: 0.9 },
  { label: "big", max: 20_000_000, color: "#ef4444", speed: 0.6 },
  { label: "huge", max: Infinity, color: "#8b5cf6", speed: 0.4 },
];

function categorize(bytes: number) {
  return SIZES.find((s) => bytes <= s.max) ?? SIZES[SIZES.length - 1];
}

// Rolling packages-per-minute. Trims timestamps older than the window, then the
// count of what remains IS the per-minute rate (window is exactly 60s).
function currentRate(): number {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  while (arrivals.length && arrivals[0] < cutoff) arrivals.shift();
  return arrivals.length;
}

function uptimeSec(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

// Telemetry snapshot attached to every outbound message so the client always has
// fresh rate/health numbers even on a quiet feed.
function telemetry() {
  const rate = currentRate();
  if (rate > peakRate) peakRate = rate;
  return { stats, total: totalPkgs, rate, peakRate, uptime: uptimeSec(), feedOk };
}

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    try { ws.send(data); } catch { clients.delete(ws); }
  }
}

// Flip feed health and push an immediate tick so the UI reacts without waiting
// for the next heartbeat.
function setFeed(ok: boolean) {
  if (ok) { pollFails = 0; lastPollAt = Date.now(); }
  if (ok === feedOk) return;
  feedOk = ok;
  broadcast({ type: "tick", ...telemetry() });
}

// ---------------------------------------------------------------- Persistence
// Keep cumulative totals across restarts so the monitor reads like an odometer
// rather than resetting to zero on every deploy. Best-effort: never throws.
async function loadStats() {
  try {
    const f = Bun.file(STATS_FILE);
    if (!(await f.exists())) return;
    const saved: any = await f.json();
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(stats) as (keyof Stats)[]) {
        if (typeof saved.stats?.[k] === "number") stats[k] = saved.stats[k];
      }
      if (typeof saved.total === "number") totalPkgs = saved.total;
      if (typeof saved.peakRate === "number") peakRate = saved.peakRate;
      console.log(`Restored stats: ${totalPkgs} packages, peak ${peakRate}/min`);
    }
  } catch (e) {
    console.error("Could not load stats", e);
  }
}

let statsDirty = false;
async function saveStats() {
  if (!statsDirty) return;
  statsDirty = false;
  try {
    await Bun.write(STATS_FILE, JSON.stringify({ stats, total: totalPkgs, peakRate }));
  } catch (e) {
    console.error("Could not save stats", e);
  }
}

// ---------------------------------------------------------------- Fetch queue
const pkgQueue: string[] = [];
let processing = false;

async function processQueue() {
  if (processing || pkgQueue.length === 0) return;
  processing = true;
  const batch = pkgQueue.splice(0, 3);
  for (const name of batch) {
    try {
      const pkg = await fetchLatestPkg(name);
      if (pkg && pkg.size > 0) {
        const sizeCat = categorize(pkg.size);
        stats[sizeCat.label as keyof Stats]++;
        totalPkgs++;
        statsDirty = true;
        arrivals.push(Date.now());
        const entry = { ...pkg, category: sizeCat.label, color: sizeCat.color, speed: sizeCat.speed };
        recentPkgs.unshift(entry);
        if (recentPkgs.length > MAX_RECENT) recentPkgs.pop();
        broadcast({ type: "new_pkg", data: entry, ...telemetry() });
        await sleep(200);
      }
    } catch {
      // skip failures
    }
  }
  processing = false;
  if (pkgQueue.length > 0) processQueue();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchLatestPkg(name: string) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const body: any = await res.json();
  const size = body.dist?.unpackedSize ?? body.dist?.size ?? 0;
  return {
    name,
    version: body.version ?? "",
    size: Number(size) || 0,
    description: (body.description ?? "").slice(0, 80) || `${name}@${body.version ?? "?"}`,
  };
}

async function initLastSeq() {
  try {
    const res = await fetch("https://replicate.npmjs.com/_changes?limit=1&descending=true", {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const body: any = await res.json();
      lastSeq = body.last_seq ?? 0;
      console.log(`Started from seq: ${lastSeq}`);
    }
  } catch (e) {
    console.error("Failed to get initial seq, using fallback", e);
    lastSeq = 0;
  }
}

async function pollChanges() {
  try {
    const url = `https://replicate.npmjs.com/_changes?since=${lastSeq}&limit=30`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { onPollFail(); return; }
    const body: any = await res.json();
    const changes = body.results ?? [];
    setFeed(true);
    if (changes.length === 0) return;
    lastSeq = body.last_seq ?? lastSeq;
    for (const change of changes) {
      if (!change.deleted && change.id && !pkgQueue.includes(change.id)) {
        pkgQueue.push(change.id);
      }
    }
    processQueue();
  } catch {
    onPollFail();
  }
}

// A single hiccup shouldn't flip the badge to "offline" — only mark the feed
// down after a few consecutive failures.
function onPollFail() {
  pollFails++;
  if (pollFails >= 3) setFeed(false);
}

// ---------------------------------------------------------------- HTTP / WS
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    }

    // Health endpoint for uptime checks / load balancers.
    if (url.pathname === "/healthz") {
      const body = {
        status: feedOk ? "ok" : "degraded",
        ...telemetry(),
        clients: clients.size,
        lastPollAt,
      };
      return Response.json(body, {
        headers: { "cache-control": "no-store" },
      });
    }

    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ type: "init", recent: recentPkgs, ...telemetry() }));
    },
    close(ws) { clients.delete(ws); },
  },
});

// Static file serving with path-traversal guard + sensible cache headers.
async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  // Reject anything that tries to climb out of ./public.
  if (rel.includes("..") || rel.includes("\0")) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(`./public${rel}`);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  // Vendored libraries are immutable; HTML/CSS/JS we author should revalidate.
  const longLived = rel.startsWith("/vendor/");
  const cache = longLived
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
  return new Response(file, { headers: { "cache-control": cache } });
}

console.log(`npm-traffic running at http://localhost:${PORT}`);

// ---------------------------------------------------------------- Boot
await loadStats();
await initLastSeq();
setInterval(pollChanges, POLL_MS);
pollChanges(); // poll immediately

// Heartbeat: keeps the rate counter decaying and doubles as a liveness ping so
// the client can tell the difference between "quiet feed" and "dead server".
setInterval(() => broadcast({ type: "tick", ...telemetry() }), HEARTBEAT_MS);

// Periodically flush cumulative stats to disk.
setInterval(saveStats, 15_000);

// Flush once on the way out so a clean restart doesn't lose the last few packages.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await saveStats();
    process.exit(0);
  });
}
