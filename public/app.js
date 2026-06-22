// NPM Traffic Control — 3D edition (Three.js / WebGL)
// Live npm publishes arrive as PBR semi-trucks driving a night highway toward
// the "NPM REGISTRY ENTRY POINT" gantry. Data feed + HUD are unchanged.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// ============================================================ World constants
const ROAD_W = 24;            // road width (x: -12..+12)
const ROAD_FAR = -210;        // horizon end of road (z)
const ROAD_NEAR = 24;         // road end behind camera (z)
const SPAWN_Z = -200;         // where trucks appear
const EXIT_Z = 20;            // where trucks are removed (past camera)
const BOOTH_Z = -17;          // toll-booth gantry position
const LANE_X = [-10, -6, -2, 2, 6, 10]; // 6 lane centers
const LANE_MAP = { tiny: 0, small: 1, medium: 2, large: 3, big: 4, huge: 5 };
const SPEED_MUL = [1.6, 1.3, 1.05, 0.85, 0.65, 0.5]; // per lane (smaller pkgs = faster)
// Truck scale by package size category (tiny rigs → huge rigs)
const SIZE_SCALE = { tiny: 0.55, small: 0.7, medium: 0.85, large: 1.0, big: 1.25, huge: 1.55 };
const MAX_TRUCKS = 32;

// ============================================================ UI state & prefs
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
// Horns default off when the user asked for reduced motion; otherwise remember choice.
let soundOn = store.get("npmtraffic.sound", !reduceMotion);
let paused = false;

// ============================================================ Renderer / scene
const canvas = document.getElementById("highway");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1a1228, 40, 195);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 5.2, 17);
camera.lookAt(0, 2.6, -55);

// PBR environment for realistic paint/metal reflections
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// ============================================================ Sky / stars / moon
function makeSky() {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 512;
  const g = c.getContext("2d").createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, "#05050f");
  g.addColorStop(0.32, "#0a0a24");
  g.addColorStop(0.58, "#181436");
  g.addColorStop(0.82, "#3a1a3a");
  g.addColorStop(1.0, "#c0603055");
  const ctx = c.getContext("2d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeSky();

// Stars
(() => {
  const N = 600;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 380;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.42; // upper dome only
    pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    pos[i * 3 + 1] = Math.cos(phi) * r * 0.7 + 30;
    pos[i * 3 + 2] = -Math.abs(Math.sin(phi) * Math.sin(theta) * r) - 60;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false });
  scene.add(new THREE.Points(geo, mat));
})();

// Moon (emissive — picked up by bloom)
(() => {
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(14, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff0dc })
  );
  moon.position.set(-150, 110, -300);
  scene.add(moon);
})();

// ============================================================ Lighting
const hemi = new THREE.HemisphereLight(0x4a4a80, 0x0a0a12, 0.55);
scene.add(hemi);

const moonLight = new THREE.DirectionalLight(0xbfc6ff, 1.5);
moonLight.position.set(-40, 55, 20);
moonLight.target.position.set(0, 0, -40);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 160;
moonLight.shadow.camera.left = -30;
moonLight.shadow.camera.right = 30;
moonLight.shadow.camera.top = 30;
moonLight.shadow.camera.bottom = -30;
moonLight.shadow.bias = -0.0004;
scene.add(moonLight);
scene.add(moonLight.target);

// Warm fill from the toll booth area
const boothGlow = new THREE.PointLight(0xcb3837, 1.2, 60, 2);
boothGlow.position.set(0, 8, BOOTH_Z);
scene.add(boothGlow);

// ============================================================ Ground & road
function makeAsphaltTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 1024;
  const ctx = c.getContext("2d");
  // base asphalt
  ctx.fillStyle = "#15151b";
  ctx.fillRect(0, 0, 256, 1024);
  // grain
  for (let i = 0; i < 9000; i++) {
    const v = 18 + Math.random() * 22;
    ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 1024, 1, 1);
  }
  // outer solid shoulder lines
  ctx.fillStyle = "rgba(230,230,200,0.55)";
  ctx.fillRect(8, 0, 4, 1024);
  ctx.fillRect(244, 0, 4, 1024);
  // dashed lane dividers (5 interior lines for 6 lanes)
  ctx.fillStyle = "rgba(245,240,200,0.5)";
  for (const x of [43, 85, 128, 171, 213]) {
    for (let y = 0; y < 1024; y += 120) ctx.fillRect(x - 2, y, 4, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 28);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const roadLen = ROAD_NEAR - ROAD_FAR;
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_W, roadLen),
  new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.85, metalness: 0.1 })
);
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, (ROAD_FAR + ROAD_NEAR) / 2);
road.receiveShadow = true;
scene.add(road);

// Desert ground flanking the road
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200),
  new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
scene.add(ground);

// Distant mountain ridge silhouette
(() => {
  const shape = new THREE.Shape();
  shape.moveTo(-600, 0);
  let x = -600;
  while (x <= 600) {
    const h = 18 + Math.sin(x * 0.012) * 14 + Math.sin(x * 0.031 + 2) * 9 + Math.sin(x * 0.005) * 10;
    shape.lineTo(x, Math.max(2, h));
    x += 12;
  }
  shape.lineTo(600, 0);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const ridge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0d0b1c, fog: false }));
  ridge.position.set(0, 0, ROAD_FAR - 30);
  scene.add(ridge);
})();

// Guard-rail posts along both shoulders
(() => {
  const postGeo = new THREE.BoxGeometry(0.18, 1.0, 0.18);
  const railGeo = new THREE.BoxGeometry(0.12, 0.25, 4);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0ac, roughness: 0.5, metalness: 0.6 });
  for (const side of [-1, 1]) {
    for (let z = ROAD_FAR + 6; z < ROAD_NEAR; z += 4) {
      const post = new THREE.Mesh(postGeo, mat);
      post.position.set(side * (ROAD_W / 2 + 0.6), 0.5, z);
      scene.add(post);
      const rail = new THREE.Mesh(railGeo, mat);
      rail.position.set(side * (ROAD_W / 2 + 0.6), 0.85, z + 2);
      scene.add(rail);
    }
  }
})();

// ============================================================ Toll-booth gantry
function buildBooth() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a38, roughness: 0.4, metalness: 0.8 });
  const span = ROAD_W + 4;

  // pillars
  const pillarGeo = new THREE.BoxGeometry(0.9, 11, 0.9);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, steel);
    p.position.set(side * (span / 2), 5.5, 0);
    p.castShadow = true;
    g.add(p);
  }
  // overhead beam
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1, 1.1, 1.1), steel);
  beam.position.set(0, 10.6, 0);
  beam.castShadow = true;
  g.add(beam);

  // sign face with npm-red text (emissive canvas texture)
  const c = document.createElement("canvas");
  c.width = 1536; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, 1536, 256);
  ctx.fillStyle = "#CB3837";
  ctx.fillRect(0, 0, 1536, 12);
  ctx.fillRect(0, 244, 1536, 12);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 86px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("REGISTRY ENTRY POINT", 768, 98);
  ctx.fillStyle = "#CB3837";
  ctx.font = "bold 46px Inter, Arial, sans-serif";
  ctx.fillText("◄ ENTERING THE REGISTRY ►", 768, 186);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.32, roughness: 0.6 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(span * 0.82, 2.6, 0.3), signMat);
  sign.position.set(0, 8.4, 0.2);
  g.add(sign);

  // npm logo badge mounted on the gantry beam, above the sign
  const lc = document.createElement("canvas");
  lc.width = 480; lc.height = 200;
  const lx = lc.getContext("2d");
  lx.scale(10, 10);          // 480/48 x, 200/20 y
  lx.translate(0, -15);      // crop to the logo band (viewBox y 15..35)
  lx.fillStyle = "#CB3837";  // red field
  lx.fill(new Path2D("M0,15h48v17H24v3H13v-3H0V15z"));
  lx.fillStyle = "#ffffff";  // white "npm" wordmark
  lx.fill(new Path2D("M3 29 8 29 8 21 11 21 11 29 13 29 13 18 3 18z"));
  lx.fill(new Path2D("M16 18v14h5v-3h5V18H16zM24 26h-3v-5h3V26z"));
  lx.fill(new Path2D("M29 18 29 29 34 29 34 21 37 21 37 29 40 29 40 21 43 21 43 29 45 29 45 18z"));
  const logoTex = new THREE.CanvasTexture(lc);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 1.25),
    new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, fog: false })
  );
  logo.position.set(0, 10.55, 0.65); // on the beam, above the sign
  g.add(logo);

  // blinking caution lights on top of the beam
  const lights = [];
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3b3a })
    );
    b.position.set(-span / 2 + (span * (i + 0.5)) / 9, 11.4, 0.5);
    g.add(b);
    lights.push(b);
  }
  g.position.z = BOOTH_Z;
  g.userData.lights = lights;
  scene.add(g);
  return g;
}
const booth = buildBooth();

// ============================================================ Truck factory
// Rounded-box cache — identical panels share one geometry instance. Soft,
// beveled edges catch the moonlight/bloom far more convincingly than hard boxes.
const _rbCache = new Map();
function rbox(w, h, d, r = 0.12, seg = 2) {
  const key = `${w},${h},${d},${r},${seg}`;
  let g = _rbCache.get(key);
  if (!g) { g = new RoundedBoxGeometry(w, h, d, seg, r); _rbCache.set(key, g); }
  return g;
}
// Half-torus fender arch, cached by tire radius.
const _archCache = new Map();
function archGeo(r) {
  let g = _archCache.get(r);
  if (!g) { g = new THREE.TorusGeometry(r + 0.06, 0.085, 8, 16, Math.PI); _archCache.set(r, g); }
  return g;
}

// Shared geometry (created once, reused per truck)
const G = {
  cab: rbox(2.7, 3.0, 2.6, 0.3, 3),
  hood: rbox(2.6, 1.5, 1.4, 0.24, 3),
  trailer: rbox(2.7, 3.3, 8.2, 0.16, 2),
  windshield: new THREE.BoxGeometry(2.3, 1.1, 0.16),
  grille: rbox(1.7, 1.15, 0.18, 0.06, 2),
  bumper: rbox(2.85, 0.42, 0.5, 0.16, 2),
  visor: rbox(2.4, 0.18, 0.7, 0.07, 1),
  headlight: new THREE.BoxGeometry(0.42, 0.34, 0.18),
  marker: new THREE.BoxGeometry(0.22, 0.16, 0.12),
  stack: new THREE.CylinderGeometry(0.1, 0.1, 2.4, 12),
  mirror: rbox(0.14, 0.7, 0.32, 0.06, 1),
  axle: new THREE.CylinderGeometry(0.08, 0.08, 2.7, 8),  // axle tube between duals
  // --- wheels: rounded torus tire + machined rim + chrome hubcap
  tire: new THREE.TorusGeometry(0.47, 0.155, 12, 24),
  tireSmall: new THREE.TorusGeometry(0.30, 0.115, 10, 20),
  rimDisc: new THREE.CylinderGeometry(0.40, 0.40, 0.30, 22),
  rimDiscSmall: new THREE.CylinderGeometry(0.26, 0.26, 0.235, 18),
  hubCap: new THREE.CylinderGeometry(0.10, 0.14, 0.40, 12),
  hubCapSmall: new THREE.CylinderGeometry(0.07, 0.10, 0.30, 10),
  // --- additional vehicle bodies (per-category silhouettes)
  carBody: rbox(1.7, 1.3, 3.4, 0.34, 3),     // compact car (tiny)
  carRoof: rbox(1.5, 0.7, 1.6, 0.3, 3),      // car cabin
  vanBody: rbox(2.2, 2.4, 5.0, 0.26, 2),     // delivery van (small)
  boxBody: rbox(2.6, 2.8, 5.6, 0.14, 2),     // straight box truck (medium)
  boxBodyL: rbox(2.6, 3.1, 7.2, 0.14, 2),    // longer box truck (large)
  bigTrailer: rbox(2.6, 3.2, 6.6, 0.14, 2),  // box trailer for "big"
  tailLight: new THREE.BoxGeometry(0.40, 0.26, 0.12),        // red rear lights
  carHood: rbox(1.7, 0.5, 1.2, 0.18, 2),                     // car hood panel
  cabSmall: rbox(2.5, 2.6, 2.4, 0.28, 3),                    // box-truck cab (lower than cargo)
  cargoGap: new THREE.BoxGeometry(2.4, 1.6, 0.3),            // fairing between cab & box
};
const M = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1622, roughness: 0.06, metalness: 0.2, transmission: 0.25, reflectivity: 0.9, clearcoat: 1.0, clearcoatRoughness: 0.1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.5, metalness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc9ccd4, roughness: 0.18, metalness: 1.0 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.85, metalness: 0.1 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x9498a2, roughness: 0.32, metalness: 0.95 }),
  chassis: new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.6, metalness: 0.7 }),
  marker: new THREE.MeshBasicMaterial({ color: 0xff5a3a }),
  headlight: new THREE.MeshBasicMaterial({ color: 0xfff8e8 }),
  taillight: new THREE.MeshBasicMaterial({ color: 0xff2a22 }),
};

// Cheap headlight "light pool" projected on the road (replaces per-truck spotlights).
const poolTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,244,214,0.85)");
  g.addColorStop(0.4, "rgba(255,238,200,0.35)");
  g.addColorStop(1, "rgba(255,238,200,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const poolGeo = new THREE.PlaneGeometry(7, 13);
const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

function makeWheel(x, z, small = false) {
  const w = new THREE.Group();
  const radius = small ? 0.41 : 0.62;
  // Rounded rubber tire (torus), filled with a machined rim + protruding hubcap.
  const tire = new THREE.Mesh(small ? G.tireSmall : G.tire, M.rubber);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  const rim = new THREE.Mesh(small ? G.rimDiscSmall : G.rimDisc, M.rim);
  rim.rotation.z = Math.PI / 2;
  const cap = new THREE.Mesh(small ? G.hubCapSmall : G.hubCap, M.chrome);
  cap.rotation.z = Math.PI / 2;
  w.add(tire, rim, cap);
  w.position.set(x, radius, z);
  w.userData.radius = radius;
  return w;
}

// A fender flare arching over a wheel, painted to match the body.
function addFender(t, x, z, radius, mat) {
  const arch = new THREE.Mesh(archGeo(radius), mat);
  arch.rotation.y = Math.PI / 2;
  arch.position.set(x, radius, z);
  t.add(arch);
}

// Two dark frame rails running under the body between the front and rear axles,
// so trucks read as bodies-on-a-chassis instead of floating boxes.
function addChassis(t, z0, z1, y = 0.6) {
  const len = Math.abs(z1 - z0) + 0.6;
  for (const x of [-0.72, 0.72]) {
    const rail = new THREE.Mesh(rbox(0.18, 0.32, len, 0.06, 1), M.chassis);
    rail.position.set(x, y, (z0 + z1) / 2);
    t.add(rail);
  }
}

// A solid axle tube spanning the wheel pair at a given z.
function addAxle(t, z, y = 0.62, scaleX = 1) {
  const axle = new THREE.Mesh(G.axle, M.chassis);
  axle.rotation.z = Math.PI / 2;
  axle.scale.y = scaleX; // cylinder length runs along its local Y
  axle.position.set(0, y, z);
  t.add(axle);
}

// Body paint shared by every vehicle — kept per-truck (distinct color per pkg).
// Physical clearcoat gives an automotive lacquer sheen over the base color.
function makePaint(pkg) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(pkg.color),
    roughness: 0.36, metalness: 0.55,
    clearcoat: 0.85, clearcoatRoughness: 0.22,
    envMapIntensity: 1.25,
  });
  m._perTruck = true; // disposed in removeTruck
  return m;
}

// Emissive headlights + a cheap additive light pool on the road ahead, plus red
// taillights at the rear. `hx` = headlight x-offset pair, `hlY` = headlight height,
// `frontZ` = cab front face z, `rearZ` = rearmost point of the vehicle, `tlY` = taillight height.
function addHeadlights(t, hx, hlY, frontZ, rearZ, tlY = hlY) {
  for (const x of hx) {
    const hl = new THREE.Mesh(G.headlight, M.headlight);
    hl.position.set(x, hlY, frontZ + 0.63);
    t.add(hl);
  }
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.03, frontZ + 6.4);
  t.add(pool);
  // red tail lights at the rear of the body
  for (const x of hx) {
    const tl = new THREE.Mesh(G.tailLight, M.taillight);
    tl.position.set(x, tlY, rearZ);
    t.add(tl);
  }
}

// ---------- tiny: compact car (2-box silhouette: hood + cabin + trunk) ----------
function buildCar(pkg) {
  const t = new THREE.Group();
  const paint = makePaint(pkg);
  const wheels = [];
  const addW = (x, z) => { const w = makeWheel(x, z, true); wheels.push(w); t.add(w); };

  // Lower body shell — one slab spanning hood → cabin floor → trunk.
  const body = new THREE.Mesh(G.carBody, paint);
  body.position.set(0, 0.78, 0);
  body.castShadow = true;
  t.add(body);
  // hood panel, slightly lower than the cabin (classic wedge)
  const hood = new THREE.Mesh(G.carHood, paint);
  hood.position.set(0, 1.05, 1.25);
  hood.castShadow = true;
  t.add(hood);
  // Greenhouse — cabin + roof sits over the rear half. Tapered by scaling.
  const cabin = new THREE.Mesh(G.carRoof, paint);
  cabin.scale.set(1, 1, 1.15);
  cabin.position.set(0, 1.78, -0.35);
  cabin.castShadow = true;
  t.add(cabin);
  // raked windshield (front) — thin glass pane tilted by rotation
  const wsF = new THREE.Mesh(G.windshield, M.glass);
  wsF.scale.set(0.68, 0.7, 1);
  wsF.position.set(0, 1.72, 0.78);
  wsF.rotation.x = -0.62;        // rake back
  t.add(wsF);
  // rear window (steeper rake)
  const wsR = new THREE.Mesh(G.windshield, M.glass);
  wsR.scale.set(0.68, 0.6, 1);
  wsR.position.set(0, 1.78, -1.05);
  wsR.rotation.x = 0.78;
  t.add(wsR);
  // side windows (thin glass slivers)
  for (const sx of [-0.86, 0.86]) {
    const sw = new THREE.Mesh(G.windshield, M.glass);
    sw.scale.set(0.04, 0.5, 0.9);
    sw.position.set(sx, 1.82, -0.35);
    t.add(sw);
  }
  // front chrome bumper
  const bumper = new THREE.Mesh(G.bumper, M.chrome);
  bumper.scale.set(0.6, 1, 0.8);
  bumper.position.set(0, 0.62, 1.75);
  t.add(bumper);
  // lights on at both ends — headlights low & wide, taillights at trunk
  addHeadlights(t, [-0.6, 0.6], 0.95, 1.65, -1.55, 0.95);

  // 2 axles, small tires, with body-colored fender arches over each wheel
  for (const [wx, wz] of [[-0.85, 1.1], [0.85, 1.1], [-0.85, -1.1], [0.85, -1.1]]) {
    addW(wx, wz);
    addFender(t, wx, wz, 0.41, paint);
  }

  t.userData.pkg = pkg;
  t.userData.wheels = wheels;
  return { group: t, wheels, topY: 2.3 };
}

// ---------- small: delivery van (tall one-volume body, cab-forward) ----------
function buildVan(pkg) {
  const t = new THREE.Group();
  const paint = makePaint(pkg);
  const wheels = [];
  const addW = (x, z) => { const w = makeWheel(x, z); wheels.push(w); t.add(w); };

  // tall single-volume cargo body
  const body = new THREE.Mesh(G.vanBody, paint);
  body.position.set(0, 1.85, -0.2);
  body.castShadow = true;
  t.add(body);
  // cab nose — slightly shorter/tapered front upper edge (wedge)
  const nose = new THREE.Mesh(G.hood, paint);
  nose.scale.set(0.85, 0.8, 0.9);
  nose.position.set(0, 1.55, 2.25);
  nose.castShadow = true;
  t.add(nose);
  // big raked windshield across the cab face
  const ws = new THREE.Mesh(G.windshield, M.glass);
  ws.scale.set(0.82, 1.5, 1);
  ws.position.set(0, 2.25, 2.0);
  ws.rotation.x = -0.5;
  t.add(ws);
  // side cab windows
  for (const sx of [-1.13, 1.13]) {
    const sw = new THREE.Mesh(G.windshield, M.glass);
    sw.scale.set(0.04, 0.6, 0.8);
    sw.position.set(sx, 2.35, 1.7);
    t.add(sw);
  }
  // side cargo panel line (subtle dark recess) for realism
  for (const sx of [-1.12, 1.12]) {
    const panel = new THREE.Mesh(G.windshield, M.dark);
    panel.scale.set(0.03, 1.2, 2.6);
    panel.position.set(sx, 1.9, -0.6);
    t.add(panel);
  }
  // bumper
  const bumper = new THREE.Mesh(G.bumper, M.chrome);
  bumper.scale.set(0.82, 1, 0.8);
  bumper.position.set(0, 0.95, 2.6);
  t.add(bumper);
  // lights on at both ends
  addHeadlights(t, [-0.75, 0.75], 1.4, 2.45, -2.5, 1.7);

  // 2 axles with fender arches
  for (const [wx, wz] of [[-1.1, 1.6], [1.1, 1.6], [-1.1, -1.9], [1.1, -1.9]]) {
    addW(wx, wz);
    addFender(t, wx, wz, 0.62, paint);
  }

  t.userData.pkg = pkg;
  t.userData.wheels = wheels;
  return { group: t, wheels, topY: 3.2 };
}

// ---------- medium & large: straight box truck (cab lower than cargo) ----------
function buildBoxTruck(pkg) {
  const t = new THREE.Group();
  const paint = makePaint(pkg);
  const wheels = [];
  const addW = (x, z) => { const w = makeWheel(x, z); wheels.push(w); t.add(w); };

  const isLarge = pkg.category === "large";
  const bodyGeo = isLarge ? G.boxBodyL : G.boxBody;
  const boxLen = isLarge ? 7.2 : 5.6;
  const boxCenterZ = -boxLen / 2 + 1.2;
  const rearZ = boxCenterZ - boxLen / 2;

  // Cargo box — tall, sits over and behind the cab
  const box = new THREE.Mesh(bodyGeo, paint);
  box.position.set(0, 2.6, boxCenterZ);
  box.castShadow = true;
  t.add(box);
  // box-top amber markers
  for (const mx of [-0.9, 0, 0.9]) {
    const m = new THREE.Mesh(G.marker, M.marker);
    m.position.set(mx, 4.25, boxCenterZ);
    t.add(m);
  }
  // subtle cargo seam (dark recess line down the side)
  for (const sx of [-1.32, 1.32]) {
    const seam = new THREE.Mesh(G.windshield, M.dark);
    seam.scale.set(0.03, 1.4, isLarge ? 3.4 : 2.6);
    seam.position.set(sx, 2.6, boxCenterZ);
    t.add(seam);
  }

  // Cab — lower than the cargo box, sits at the front
  const cab = new THREE.Mesh(G.cabSmall, paint);
  cab.position.set(0, 2.0, 1.6);
  cab.castShadow = true;
  t.add(cab);
  // gap/fairing between cab roof and the taller cargo box
  const fairing = new THREE.Mesh(G.cargoGap, paint);
  fairing.position.set(0, 3.0, 0.4);
  fairing.rotation.x = 0.5;
  t.add(fairing);
  // raked windshield
  const ws = new THREE.Mesh(G.windshield, M.glass);
  ws.scale.set(0.85, 1.1, 1);
  ws.position.set(0, 2.5, 2.5);
  ws.rotation.x = -0.5;
  t.add(ws);
  // side cab windows
  for (const sx of [-1.27, 1.27]) {
    const sw = new THREE.Mesh(G.windshield, M.glass);
    sw.scale.set(0.04, 0.55, 0.7);
    sw.position.set(sx, 2.5, 1.6);
    t.add(sw);
  }
  // bumper
  const bumper = new THREE.Mesh(G.bumper, M.chrome);
  bumper.scale.set(0.9, 1, 0.9);
  bumper.position.set(0, 0.95, 2.95);
  t.add(bumper);
  // lights on at both ends
  const frontZ = 2.7;
  addHeadlights(t, [-0.9, 0.9], 1.45, frontZ, rearZ, 1.7);

  // underbody frame rails + axles, then wheels with fender flares
  const rearAxleZ = isLarge ? -4.0 : -1.9;
  addChassis(t, 1.3, rearAxleZ);
  const axles = isLarge ? [[1.3, 1.25], [-1.6, 1.25], [-4.0, 1.25]] : [[1.3, 1.25], [-1.9, 1.2]];
  for (const [z, xx] of axles) {
    addAxle(t, z);
    addW(-xx, z); addW(xx, z);
    addFender(t, -xx, z, 0.62, paint);
    addFender(t, xx, z, 0.62, paint);
  }

  t.userData.pkg = pkg;
  t.userData.wheels = wheels;
  return { group: t, wheels, topY: isLarge ? 4.4 : 4.1 };
}

// ---------- big: articulated cab + trailer (5th-wheel gap, no chrome stacks) ----------
function buildBigTruck(pkg) {
  const t = new THREE.Group();
  const paint = makePaint(pkg);
  const wheels = [];
  const addW = (x, z) => { const w = makeWheel(x, z); wheels.push(w); t.add(w); };

  // Trailer — tall box, rearmost
  const trailerCenterZ = -3.6;
  const trailer = new THREE.Mesh(G.bigTrailer, paint);
  trailer.position.set(0, 2.95, trailerCenterZ);
  trailer.castShadow = true;
  t.add(trailer);
  for (const mx of [-0.9, 0, 0.9]) {
    const m = new THREE.Mesh(G.marker, M.marker);
    m.position.set(mx, 4.65, trailerCenterZ);
    t.add(m);
  }
  // trailer rear doors seam (dark recess) for realism
  const doorSeam = new THREE.Mesh(G.windshield, M.dark);
  doorSeam.scale.set(2.4, 2.8, 0.04);
  doorSeam.position.set(0, 2.95, trailerCenterZ - 3.3);
  t.add(doorSeam);

  // Cab — separate, lower & shorter, with a visible gap to the trailer (5th wheel)
  const cab = new THREE.Mesh(G.cabSmall, paint);
  cab.position.set(0, 2.0, 1.7);
  cab.castShadow = true;
  t.add(cab);
  // hood sloping down to the bumper
  const hood = new THREE.Mesh(G.hood, paint);
  hood.scale.set(0.95, 0.9, 0.95);
  hood.position.set(0, 1.5, 2.7);
  hood.castShadow = true;
  t.add(hood);
  // raked windshield
  const ws = new THREE.Mesh(G.windshield, M.glass);
  ws.scale.set(0.85, 1.2, 1);
  ws.position.set(0, 2.55, 2.55);
  ws.rotation.x = -0.5;
  t.add(ws);
  // side cab windows
  for (const sx of [-1.27, 1.27]) {
    const sw = new THREE.Mesh(G.windshield, M.glass);
    sw.scale.set(0.04, 0.55, 0.7);
    sw.position.set(sx, 2.55, 1.7);
    t.add(sw);
  }
  // bumper + mirrors (no chrome stacks — that's the full semi / huge)
  const bumper = new THREE.Mesh(G.bumper, M.chrome);
  bumper.scale.set(0.9, 1, 0.9);
  bumper.position.set(0, 0.95, 3.0);
  t.add(bumper);
  for (const sx of [-1.3, 1.3]) {
    const mir = new THREE.Mesh(G.mirror, M.dark);
    mir.position.set(sx + sx * 0.18, 2.7, 2.4);
    t.add(mir);
  }
  // lights on at both ends
  const frontZ = 2.7;
  addHeadlights(t, [-0.95, 0.95], 1.45, frontZ, trailerCenterZ - 3.3, 1.7);

  // frame rail bridging the 5th-wheel gap + axle tubes
  addChassis(t, 1.3, -5.0);
  addAxle(t, 1.3);
  addAxle(t, -3.4); addAxle(t, -5.0);
  // wheels: front steer axle + dual rear axles on trailer
  addW(-1.25, 1.3); addW(1.25, 1.3);
  for (const z of [-5.0, -3.4]) {
    for (const x of [-1.35, -1.0, 1.0, 1.35]) addW(x, z);
  }
  // fender flares: steer wheels + one wide flare over each rear dual cluster
  addFender(t, -1.25, 1.3, 0.62, paint); addFender(t, 1.25, 1.3, 0.62, paint);
  addFender(t, -1.18, -4.2, 0.72, paint); addFender(t, 1.18, -4.2, 0.72, paint);

  t.userData.pkg = pkg;
  t.userData.wheels = wheels;
  return { group: t, wheels, topY: 4.75 };
}

// ---------- huge: full semi (unchanged from original buildTruck) ----------
function buildSemi(pkg) {
  const t = new THREE.Group();
  const paint = makePaint(pkg);
  const wheels = [];
  const addW = (x, z) => { const w = makeWheel(x, z); wheels.push(w); t.add(w); };

  // Trailer (rear, lower z)
  const trailer = new THREE.Mesh(G.trailer, paint);
  trailer.position.set(0, 3.0, -4.6);
  trailer.castShadow = true;
  t.add(trailer);
  // trailer top markers
  for (const mx of [-0.9, 0, 0.9]) {
    const m = new THREE.Mesh(G.marker, M.marker);
    m.position.set(mx, 4.7, -0.6);
    t.add(m);
  }

  // Cab (front)
  const cab = new THREE.Mesh(G.cab, paint);
  cab.position.set(0, 2.4, 0.7);
  cab.castShadow = true;
  t.add(cab);
  const hood = new THREE.Mesh(G.hood, paint);
  hood.position.set(0, 1.55, 1.9);
  hood.castShadow = true;
  t.add(hood);

  // windshield + visor
  const ws = new THREE.Mesh(G.windshield, M.glass);
  ws.position.set(0, 3.05, 2.02);
  t.add(ws);
  const visor = new THREE.Mesh(G.visor, M.dark);
  visor.position.set(0, 3.65, 1.85);
  t.add(visor);

  // grille + bumper
  const grille = new THREE.Mesh(G.grille, M.chrome);
  grille.position.set(0, 1.6, 2.62);
  t.add(grille);
  const bumper = new THREE.Mesh(G.bumper, M.chrome);
  bumper.position.set(0, 1.0, 2.55);
  t.add(bumper);

  // headlights + cheap light pool on the road
  for (const hx of [-0.95, 0.95]) {
    const hl = new THREE.Mesh(G.headlight, M.headlight);
    hl.position.set(hx, 1.55, 2.63);
    t.add(hl);
  }
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.03, 9);
  t.add(pool);
  // red tail lights at the back of the trailer
  for (const tx of [-1.0, 1.0]) {
    const tl = new THREE.Mesh(G.tailLight, M.taillight);
    tl.position.set(tx, 2.0, -8.7);
    t.add(tl);
  }

  // exhaust stacks + mirrors
  for (const sx of [-1.25, 1.25]) {
    const stack = new THREE.Mesh(G.stack, M.chrome);
    stack.position.set(sx, 3.3, -0.4);
    t.add(stack);
    const mir = new THREE.Mesh(G.mirror, M.dark);
    mir.position.set(sx + sx * 0.18, 3.0, 1.9);
    t.add(mir);
  }

  // frame rail from steer axle to trailer rear + axle tubes
  addChassis(t, 1.3, -6.0);
  addAxle(t, 1.3);
  addAxle(t, -4.6); addAxle(t, -6.0);
  // wheels — front axle (cab), 2 rear axles (trailer, dual)
  addW(-1.25, 1.3); addW(1.25, 1.3);
  for (const z of [-6.0, -4.6]) {
    for (const x of [-1.35, -1.0, 1.0, 1.35]) addW(x, z);
  }
  // fender flares: steer wheels + a wide flare over each rear dual cluster
  addFender(t, -1.25, 1.3, 0.62, paint); addFender(t, 1.25, 1.3, 0.62, paint);
  addFender(t, -1.18, -5.3, 0.78, paint); addFender(t, 1.18, -5.3, 0.78, paint);

  t.userData.pkg = pkg;
  t.userData.wheels = wheels;
  return { group: t, wheels, topY: 5.3 };
}

// ============================================================ Truck factory dispatch
const BUILDERS = {
  tiny: buildCar,
  small: buildVan,
  medium: buildBoxTruck,
  large: buildBoxTruck,
  big: buildBigTruck,
  huge: buildSemi,
};
function buildTruck(pkg) {
  const built = (BUILDERS[pkg.category] ?? buildVan)(pkg);
  return built;
}

// ============================================================ Truck lifecycle
const trucks = [];
let truckId = 0;

function addTruck(pkg) {
  const lane = LANE_MAP[pkg.category] ?? 1;
  const laneX = LANE_X[lane] + (Math.random() - 0.5) * 1.4;
  const { group, topY: shapeTopY } = buildTruck(pkg);
  group.position.set(laneX, 0, SPAWN_Z);
  // size the rig to its package category (uniform scale keeps wheels on the road)
  const scale = (SIZE_SCALE[pkg.category] ?? 1) * (0.95 + Math.random() * 0.1);
  group.scale.setScalar(scale);
  const topY = shapeTopY * scale + 0.5; // label anchor just above the vehicle roof
  const speed = (6 + SPEED_MUL[lane] * 16) * (0.85 + Math.random() * 0.3);

  // HTML label
  const el = document.createElement("div");
  el.className = "truck-label";
  el.style.setProperty("--c", pkg.color);
  const ver = pkg.version ? `v${pkg.version}` : (pkg.description || "");
  el.innerHTML =
    `<span class="tl-name">${escapeHtml(pkg.name)}</span>` +
    (ver ? `<span class="tl-desc">${escapeHtml(ver)}</span>` : "") +
    `<span class="tl-badge">${pkg.category.toUpperCase()}</span>`;
  el.addEventListener("click", () => openPkg(pkg.name));
  labelsEl.appendChild(el);

  // Only full semis (huge) honk — no other vehicle type.
  const willHonk = pkg.category === "huge" && Math.random() < 0.35;
  scene.add(group);
  trucks.push({ id: truckId++, group, speed, pkg, el, alpha: 0, topY, willHonk, honksLeft: willHonk ? 2 + Math.floor(Math.random() * 3) : 0, honkCooldown: 0 });

  while (trucks.length > MAX_TRUCKS) evictOldestTruck();
}

function removeTruck(i) {
  const t = trucks[i];
  scene.remove(t.group);
  t.group.traverse((o) => { if (o.isMesh && o.material && o.material._perTruck) o.material.dispose(); });
  t.el.remove();
  trucks.splice(i, 1);
}

// Evict the truck that has travelled the furthest (closest to / past the exit)
// rather than the oldest by spawn order — this keeps slow outer-lane rigs on
// the road until they actually reach the registry instead of mid-trip.
function evictOldestTruck() {
  let best = -Infinity, idx = -1;
  for (let i = 0; i < trucks.length; i++) {
    const z = trucks[i].group.position.z;
    if (z > best) { best = z; idx = i; }
  }
  if (idx >= 0) removeTruck(idx);
}

// ============================================================ Label projection
const labelsEl = document.getElementById("labels");
const _v = new THREE.Vector3();

function updateLabels() {
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;

  for (const t of trucks) {
    // every truck carries its label; fades in once off the far horizon, out as it passes
    const z = t.group.position.z;
    const target = z > -150 && z < 13 ? 1 : 0;
    t.alpha += (target - t.alpha) * 0.08;
    if (t.alpha < 0.02) { t.el.style.opacity = "0"; t.el.style.display = "none"; continue; }
    _v.set(t.group.position.x, t.topY, z).project(camera);
    if (_v.z > 1) { t.el.style.display = "none"; continue; }
    const sx = _v.x * halfW + halfW;
    const sy = -_v.y * halfH + halfH;
    t.el.style.display = "block";
    t.el.style.opacity = String(t.alpha);
    t.el.style.transform = `translate(-50%,-100%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
  }
}

// ============================================================ Picking (click)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function pickTruck(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(trucks.map((t) => t.group), true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.pkg) o = o.parent;
  return o ? o.userData.pkg : null;
}
canvas.addEventListener("click", (e) => {
  const pkg = pickTruck(e.clientX, e.clientY);
  if (pkg) openPkg(pkg.name);
});
canvas.addEventListener("mousemove", (e) => {
  canvas.style.cursor = pickTruck(e.clientX, e.clientY) ? "pointer" : "default";
});
function openPkg(name) {
  window.open(`https://www.npmjs.com/package/${encodeURIComponent(name)}`, "_blank", "noopener");
}

// ============================================================ Post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55, 0.5, 0.9
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
if (reduceMotion) bloom.strength *= 0.6;

// Adaptive quality: if the GPU can't keep up, drop pixel ratio + bloom once so
// weaker machines stay smooth instead of stuttering at full quality.
let perfReduced = false;
let slowFrames = 0;
function reducePerf() {
  perfReduced = true;
  renderer.setPixelRatio(1);
  bloom.strength = Math.max(0.25, bloom.strength * 0.55);
  console.info("npm-traffic: lowered render quality for smoother playback");
}

// ============================================================ Honk (Web Audio)
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
document.addEventListener("click", () => {
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") ctx.resume();
}, { once: true });

// Horn voice per package size. A real air horn isn't a musical chord — the
// multiple horns on a semi are tuned to roughly the same pitch but drift a few
// cents apart, which produces a slow "chorus beat" that sounds powerful rather
// than pretty. We model that with two slightly-detuned oscillators through a
// lowpass. Bigger rigs = lower, longer, louder; small ones = short high beep.
//   freq    = fundamental pitch
//   dur     = sustain length
//   gain    = loudness
//   detune  = cents between the two oscillators (the chorus beat) — bigger = more
//   cutoff  = lowpass ceiling, keeps it round instead of buzzy
const HORN_PROFILE = {
  tiny:   { freq: 520, dur: 0.22, gain: 0.15, detune: 0,  cutoff: 2200 },
  small:  { freq: 392, dur: 0.28, gain: 0.18, detune: 0,  cutoff: 1900 },
  medium: { freq: 294, dur: 0.34, gain: 0.21, detune: 6,  cutoff: 1500 },
  large:  { freq: 220, dur: 0.46, gain: 0.25, detune: 10, cutoff: 1200 },
  big:    { freq: 165, dur: 0.62, gain: 0.29, detune: 14, cutoff: 950 },
  huge:   { freq: 110, dur: 0.85, gain: 0.33, detune: 18, cutoff: 760 },
};

// panX is the truck's world X → stereo pan, so a left-lane rig honks from the left.
function playHonk(category, panX = 0) {
  if (!soundOn) return;
  const p = HORN_PROFILE[category] ?? HORN_PROFILE.medium;
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  const end = now + p.dur;

  // stereo pan by lane position
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, panX / 12));
  panner.connect(ctx.destination);

  // lowpass keeps the tone round/brassy instead of buzzy
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = p.cutoff;
  lp.Q.value = 1.0;
  lp.connect(panner);

  // master amplitude: fast clean attack → hold → quick release. No fade-in.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(p.gain, now + 0.01);
  master.gain.setValueAtTime(p.gain, now + p.dur * 0.7);
  master.gain.exponentialRampToValueAtTime(0.0001, end);
  master.connect(lp);

  // Two oscillators a few cents apart = the chorus beat of a real dual air horn.
  // Tiny/small (detune 0) voice a single clean tone.
  const oscA = ctx.createOscillator();
  oscA.type = "sawtooth";
  oscA.frequency.value = p.freq;
  oscA.detune.value = -p.detune / 2;
  oscA.connect(master);
  oscA.start(now);
  oscA.stop(end);

  if (p.detune > 0) {
    const oscB = ctx.createOscillator();
    oscB.type = "sawtooth";
    oscB.frequency.value = p.freq;
    oscB.detune.value = p.detune / 2;
    oscB.connect(master);
    oscB.start(now);
    oscB.stop(end);
  }
}

// ============================================================ Render loop
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (!paused) {
    for (let i = trucks.length - 1; i >= 0; i--) {
      const t = trucks[i];
      const adv = t.speed * dt;
      t.group.position.z += adv;
      for (const w of t.group.userData.wheels) w.rotation.x -= adv / w.userData.radius;
      if (t.willHonk && t.honksLeft > 0 && t.honkCooldown <= 0 && t.group.position.z > -80) {
        playHonk(t.pkg.category, t.group.position.x);
        t.honksLeft--;
        t.honkCooldown = 0.6 + Math.random() * 0.6;
      }
      t.honkCooldown -= dt;
      if (t.group.position.z > EXIT_Z) removeTruck(i);
    }

    // blink booth caution lights
    for (let i = 0; i < booth.userData.lights.length; i++) {
      const on = Math.sin(time * 4 + i * 0.9) > 0;
      booth.userData.lights[i].material.color.setHex(on ? 0xff3b3a : 0x401010);
    }
  }

  // adaptive quality: react to a sustained run of slow frames, just once
  if (!perfReduced) {
    if (dt > 1 / 30) { if (++slowFrames > 150) reducePerf(); }
    else if (slowFrames > 0) slowFrames--;
  }

  updateLabels();
  composer.render();
  requestAnimationFrame(animate);
}
animate();

// ============================================================ Resize
window.addEventListener("resize", () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

// ============================================================ Controls
const soundBtn = document.getElementById("btn-sound");
const pauseBtn = document.getElementById("btn-pause");

function syncSoundBtn() {
  soundBtn.classList.toggle("muted", !soundOn);
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  soundBtn.title = soundOn ? "Mute horns (M)" : "Unmute horns (M)";
}
function syncPauseBtn() {
  pauseBtn.classList.toggle("active", paused);
  pauseBtn.setAttribute("aria-pressed", String(paused));
  pauseBtn.title = paused ? "Resume traffic (Space)" : "Pause traffic (Space)";
}
function toggleSound() {
  soundOn = !soundOn;
  store.set("npmtraffic.sound", soundOn);
  syncSoundBtn();
  if (soundOn) { const c = getAudioCtx(); if (c.state === "suspended") c.resume(); }
}
function togglePause() {
  paused = !paused;
  if (!paused) clock.getDelta(); // drop the long frame accrued while paused
  syncPauseBtn();
  refreshStatus();
}
function toggleCinematic() {
  document.body.classList.toggle("cinematic");
}
soundBtn.addEventListener("click", toggleSound);
pauseBtn.addEventListener("click", togglePause);
syncSoundBtn();
syncPauseBtn();

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") {
    if (e.target instanceof HTMLButtonElement) return; // let a focused button handle it
    e.preventDefault();
    togglePause();
  } else if (e.code === "KeyM") {
    toggleSound();
  } else if (e.code === "KeyH") {
    toggleCinematic();
  }
});

// ============================================================ Connection status
const badgeEl = document.getElementById("status-badge");
const badgeText = badgeEl.querySelector(".sb-text");
let wsConnected = false;
let everConnected = false;
let reconnecting = false;
let feedOk = false;

const BADGE = {
  connecting:   ["connecting", "CONNECTING"],
  live:         ["live", "LIVE"],
  degraded:     ["degraded", "FEED LAG"],
  reconnecting: ["reconnecting", "RECONNECTING"],
  offline:      ["offline", "OFFLINE"],
  paused:       ["paused", "PAUSED"],
};
function applyBadge(state) {
  const [cls, text] = BADGE[state];
  badgeEl.className = cls;
  badgeText.textContent = text;
}
function refreshStatus() {
  if (paused) return applyBadge("paused");
  if (!wsConnected) return applyBadge(reconnecting ? "reconnecting" : (everConnected ? "offline" : "connecting"));
  if (!feedOk) return applyBadge("degraded");
  applyBadge("live");
}

// ============================================================ Telemetry / HUD
let stats = { tiny: 0, small: 0, medium: 0, large: 0, big: 0, huge: 0 };
let total = 0;
let serverUptime = 0;
let serverUptimeAt = performance.now();
const sessionPkgs = [];
const MAX_LOG = 200;

const rateValEl = document.getElementById("rate-val");
const rateCardEl = document.getElementById("rate-card");
const peakEl = document.getElementById("tm-peak");
const uptimeEl = document.getElementById("tm-uptime");

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function fmtUptime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

function addLogEntry(pkg) {
  sessionPkgs.unshift(pkg);
  if (sessionPkgs.length > MAX_LOG) sessionPkgs.pop();
  const list = document.getElementById("log-list");
  const el = document.createElement("div");
  el.className = "log-entry";
  el.dataset.name = pkg.name;
  el.innerHTML = `
    <span class="log-dot" style="background:${pkg.color}"></span>
    <span class="log-name">${escapeHtml(pkg.name)}</span>
    <span class="log-badge" style="background:${pkg.color}22;color:${pkg.color}">${pkg.category}</span>
    <span class="log-time">${new Date().toLocaleTimeString()}</span>
  `;
  el.addEventListener("click", () => openPkg(pkg.name));
  list.prepend(el);
  while (list.children.length > MAX_LOG) list.lastChild.remove();
}

function bumpCard(card) {
  card.classList.remove("bump");
  void card.offsetWidth; // restart the animation
  card.classList.add("bump");
}

function updateUI() {
  for (const [cat, val] of Object.entries(stats)) {
    const card = document.querySelector(`.stat-card[data-cat="${cat}"]`);
    if (!card) continue;
    const el = card.querySelector(".stat-val");
    if (el && el.textContent !== String(val)) { el.textContent = val; bumpCard(card); }
  }
  const totalEl = document.getElementById("total-val");
  if (totalEl) totalEl.textContent = total.toLocaleString();
  document.title = total ? `(${total.toLocaleString()}) NPM Traffic Control` : "NPM Traffic Control";
}

// Fold a server message's telemetry fields into the HUD.
function applyTelemetry(msg) {
  if (msg.stats) stats = msg.stats;
  if (typeof msg.total === "number") total = msg.total;
  if (typeof msg.feedOk === "boolean") feedOk = msg.feedOk;
  if (typeof msg.uptime === "number") { serverUptime = msg.uptime; serverUptimeAt = performance.now(); }
  if (typeof msg.rate === "number") {
    rateValEl.textContent = msg.rate;
    rateCardEl.classList.toggle("hot", msg.rate > 0);
  }
  if (typeof msg.peakRate === "number") peakEl.textContent = `peak ${msg.peakRate}/min`;
  updateUI();
  refreshStatus();
}

// Tick the uptime locally so it counts up smoothly between server messages.
setInterval(() => {
  uptimeEl.textContent = fmtUptime(serverUptime + (performance.now() - serverUptimeAt) / 1000);
}, 1000);

// ============================================================ WebSocket (resilient)
const proto = location.protocol === "https:" ? "wss" : "ws";
let ws = null;
let seeded = false;
let reconnectTimer = null;
let reconnectDelay = 1000;

function connect() {
  reconnecting = false;
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    wsConnected = true;
    everConnected = true;
    reconnectDelay = 1000;
    refreshStatus();
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "init") {
      applyTelemetry(msg);
      // Seed the scene once; on later reconnects skip it to avoid a pile-up.
      if (!seeded && Array.isArray(msg.recent)) {
        seeded = true;
        for (const pkg of msg.recent.slice(0, 12)) { addLogEntry(pkg); if (!paused) addTruck(pkg); }
      }
    } else if (msg.type === "new_pkg") {
      applyTelemetry(msg);
      addLogEntry(msg.data);
      if (!paused) addTruck(msg.data);
    } else if (msg.type === "tick") {
      applyTelemetry(msg);
    }
  };

  ws.onclose = () => {
    wsConnected = false;
    feedOk = false;
    scheduleReconnect();
  };
  ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
}

// Exponential backoff (1s → 15s) instead of a brute-force page reload, so the
// session log and stats survive a dropped connection.
function scheduleReconnect() {
  reconnecting = true;
  refreshStatus();
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(Math.round(reconnectDelay * 1.7), 15000);
}

refreshStatus();
connect();
