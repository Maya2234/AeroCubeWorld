/* =====================================================================
   make-city-maps.mjs — the Frutiger Aero city used by Levels 1d, 2 and 3.

   Run it with:   node tools/make-city-maps.mjs
   It writes:     assets/color-map.png    (RGB colours)
                  assets/height-map.png   (grayscale heights)

   Both images come from the same layout, so a tower's height and its roof
   colour always line up:
     - glassy towers scattered at the back (far from the camera) on a pale
       plaza with a wandering edge, rising around a few downtown spots, with
       some low buildings spilling out onto the grass around it
     - a lake on the left
     - bright rolling hills, with a big one in the foreground
     - scattered trees on the grass
     - two roads curving in from the edge of the map to the plaza

   Brightness in height-map.png is 0..1 of IMAGE_HEIGHT_RATIO in index.js,
   so the ground uses only the bottom slice and the towers use the rest.

   Image row 0 is the FAR edge of the grid and the last row the near edge;
   image column 0 is the left edge (as seen from the default camera, which
   sits off the near-right corner).

   The layout below is written for a 0..1 square, but the image covers
   CITY_EXTENT times that width (read from index.js), so the extra is a
   margin of hills and trees all the way around. index.js builds that many
   more cubes, and the camera stays framed on the middle square.
   ===================================================================== */

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SEED = 20261102;     // change this for a different city

const EXTENT = (() => {
  const match = readFileSync('index.js', 'utf8').match(/const CITY_EXTENT\s*=\s*([\d.]+)/);
  if (!match) throw new Error('Could not find CITY_EXTENT in index.js');
  return Number(match[1]);
})();

// Source resolution; grid resolutions sample down from this. Grows with the
// margin so the middle square keeps about 512 pixels of detail.
const SIZE = Math.round(512 * EXTENT);

/* ---------- PNG encoding ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

// `pixels` is width * height * channels bytes.
function encodePng(width, height, channels, pixels) {
  const colorType = channels === 3 ? 2 : 0;
  const stride = width * channels;

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;          // bit depth
  header[9] = colorType;  // 0 = grayscale, 2 = RGB

  // Every scanline is prefixed with its filter byte; 0 means "no filter".
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- randomness ---------- */

// Small seeded generator, so the same SEED always builds the same city.
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(SEED);

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7 + SEED * 0.0001) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency);
    total += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return sum / total;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hex(value) {
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
}

/* ---------- layout ---------- */

const CITY = { u: 0.37, v: 0.31, ru: 0.28, rv: 0.22 };   // far-left of centre
const LAKE = { u: 0.2, v: 0.7, ru: 0.15, rv: 0.11 };
const FRONT_HILL = { u: 0.8, v: 0.82, radius: 0.28 };

const COLORS = {
  grassLow: hex('#3cb52e'),
  grassHigh: hex('#a6e83c'),
  tree: hex('#1f9a3a'),
  lakeDeep: hex('#1a8fd6'),
  lakeShallow: hex('#6fdcf0'),
  plaza: hex('#dcf0f6'),
  road: hex('#b4c6d2'),
  roofs: ['#f6fcff', '#e0f4fc', '#bfe6f7', '#9fd8f2', '#cdf5ea', '#e9f8ff'].map(hex),
};

// Ground heights, in height-map brightness (0..1 of the tallest tower).
const LAKE_FLOOR = 0;
const GRASS_BASE = 0.02;
const GRASS_HILLS = 0.07;
const FRONT_HILL_HEIGHT = 0.08;
const PLAZA = 0.03;
const TREE = 0.035;

// 0 outside the lake, 1 in its middle; the coastline wobbles with noise.
function lakeAmount(u, v) {
  const du = (u - LAKE.u) / LAKE.ru;
  const dv = (v - LAKE.v) / LAKE.rv;
  const wobble = (fbm(u * 6 + 3.1, v * 6 + 8.4, 3) - 0.5) * 0.5;
  return 1 - smoothstep(0.75, 1.0, Math.hypot(du, dv) + wobble);
}

// 1 inside the city's plaza, 0 outside. The outline is a wide oval whose
// edge wanders in and out with noise, so it isn't a perfect circle.
function cityAmount(u, v) {
  const du = (u - CITY.u) / CITY.ru;
  const dv = (v - CITY.v) / CITY.rv;
  const wobble = (fbm(u * 5 + 2.3, v * 5 + 7.1, 3) - 0.5) * 0.55;
  return 1 - smoothstep(0.85, 1.05, Math.hypot(du, dv) + wobble);
}

// Two roads curving in from the edge of the map to the plaza: one from the
// near-right corner past the foreground hill, one from the right. Each is a
// quadratic curve: it starts at `from`, bends toward `via` and ends at `to`.
const ROADS = [
  { from: [1.4, 1.27], via: [0.85, 0.72], to: [0.49, 0.46] },
  { from: [1.4, 0.0], via: [0.9, 0.2], to: [0.57, 0.3] },
];
const ROAD_HALF_WIDTH = 0.012;

// Each road as a chain of short straight pieces, plus a bounding box so most
// pixels can skip the road without measuring anything.
const roadPieces = ROADS.map(({ from, via, to }) => {
  const points = [];
  for (let k = 0; k <= 80; k++) {
    const t = k / 80;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push([
      a * from[0] + b * via[0] + c * to[0],
      a * from[1] + b * via[1] + c * to[1],
    ]);
  }
  const us = points.map((p) => p[0]);
  const vs = points.map((p) => p[1]);
  return {
    points,
    box: [
      Math.min(...us) - ROAD_HALF_WIDTH, Math.max(...us) + ROAD_HALF_WIDTH,
      Math.min(...vs) - ROAD_HALF_WIDTH, Math.max(...vs) + ROAD_HALF_WIDTH,
    ],
  };
});

// `extra` widens the road, so trees can keep their distance from it.
function onRoad(u, v, extra = 0) {
  const reach = ROAD_HALF_WIDTH + extra;
  for (const { points, box } of roadPieces) {
    if (u < box[0] - extra || u > box[1] + extra || v < box[2] - extra || v > box[3] + extra) continue;
    for (let k = 0; k < points.length - 1; k++) {
      const [ax, ay] = points[k];
      const [bx, by] = points[k + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.min(Math.max(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy), 0), 1);
      if (Math.hypot(u - (ax + dx * t), v - (ay + dy * t)) <= reach) return true;
    }
  }
  return false;
}

function grassHeight(u, v) {
  const hills = fbm(u * 2.4 + 1.7, v * 2.4 + 5.3);
  const d = Math.hypot(u - FRONT_HILL.u, v - FRONT_HILL.v) / FRONT_HILL.radius;
  const frontHill = Math.exp(-d * d * 2.2);
  return GRASS_BASE + GRASS_HILLS * hills + FRONT_HILL_HEIGHT * frontHill;
}

// The city's skyline rises around a few "downtown" spots instead of one
// centre, so the tallest towers form uneven clusters.
const HOTSPOTS = [
  { u: 0.33, v: 0.3, peak: 1.0, r: 0.13 },
  { u: 0.48, v: 0.24, peak: 0.75, r: 0.1 },
  { u: 0.26, v: 0.41, peak: 0.6, r: 0.09 },
];

function skyline(u, v) {
  let best = 0;
  for (const h of HOTSPOTS) {
    const d = Math.hypot(u - h.u, v - h.v) / h.r;
    best = Math.max(best, h.peak * Math.exp(-d * d));
  }
  return best;
}

const STREET = 0.018;       // the gap left between neighbouring buildings
const PAVING = 0.012;       // how far the pale paving reaches around a building

function overlapsBuilding(u, v, w, d, gap) {
  return buildings.some((b) =>
    Math.abs(u - b.u) < (w + b.w) / 2 + gap && Math.abs(v - b.v) < (d + b.d) / 2 + gap);
}

const randomRoof = () => COLORS.roofs[Math.floor(random() * COLORS.roofs.length)];

// Towers scattered at random inside the city's outline, each a random size,
// none touching. Height follows the skyline, with plenty of variety and the
// odd slender tower poking up above its neighbours.
const buildings = [];
buildings.push({ u: 0.33, v: 0.3, w: 0.04, d: 0.036, height: 1, color: COLORS.roofs[0] });

for (let attempt = 0; attempt < 3000 && buildings.length < 48; attempt++) {
  const u = CITY.u + (random() * 2 - 1) * CITY.ru * 1.15;
  const v = CITY.v + (random() * 2 - 1) * CITY.rv * 1.15;
  if (cityAmount(u, v) < 0.6) continue;

  const w = 0.02 + random() * 0.024;
  const d = 0.02 + random() * 0.024;
  if (overlapsBuilding(u, v, w, d, STREET)) continue;

  let height = 0.14 + 0.8 * skyline(u, v) * (0.65 + 0.55 * random());
  if (random() < 0.08) height += 0.22;
  buildings.push({ u, v, w, d, height: Math.min(height, 0.95), color: randomRoof() });
}

// A few low buildings spill out onto the grass around the city's edge, so it
// fades into the countryside instead of stopping at a hard line. They stay
// off the roads and the lake, and out of the strip along the far edge where
// the wind turbines stand.
for (let attempt = 0, houses = 0; attempt < 3000 && houses < 16; attempt++) {
  const angle = random() * Math.PI * 2;
  const reach = 1.05 + random() * 0.4;
  const u = CITY.u + Math.cos(angle) * CITY.ru * reach;
  const v = CITY.v + Math.sin(angle) * CITY.rv * reach;
  if (v < 0.13 || cityAmount(u, v) > 0.3 || lakeAmount(u, v) > 0 || onRoad(u, v, 0.02)) continue;

  const w = 0.014 + random() * 0.01;
  const d = 0.014 + random() * 0.01;
  if (overlapsBuilding(u, v, w, d, STREET * 1.5)) continue;

  // Measured from the ground under it, since the hills vary in height.
  const height = grassHeight(u, v) + 0.05 + random() * 0.05;
  buildings.push({ u, v, w, d, height, color: randomRoof() });
  houses++;
}

// Trees: small dark-green bumps, only on open grass, over the whole image
// including the margin. Kept at the same density as in the middle square.
const LOW = 0.5 - EXTENT / 2;
const HIGH = 0.5 + EXTENT / 2;
const trees = [];
while (trees.length < Math.round(140 * EXTENT * EXTENT)) {
  const u = LOW + 0.03 + random() * (EXTENT - 0.06);
  const v = LOW + 0.03 + random() * (EXTENT - 0.06);
  // Trees grow between the city's buildings too, like parks, but never on
  // the paving, the roads or the lake.
  const r = 0.008 + random() * 0.006;
  if (lakeAmount(u, v) > 0.01 || onRoad(u, v, 0.02)) continue;
  if (overlapsBuilding(u, v, 2 * r, 2 * r, PAVING + 0.004)) continue;
  trees.push({ u, v, r });
}

// Trees bucketed into a coarse grid, so each pixel only checks its own
// neighbourhood instead of every tree.
const BUCKET = 0.05;
const treeBuckets = new Map();
for (const t of trees) {
  const key = `${Math.floor(t.u / BUCKET)},${Math.floor(t.v / BUCKET)}`;
  if (!treeBuckets.has(key)) treeBuckets.set(key, []);
  treeBuckets.get(key).push(t);
}

function buildingAt(u, v) {
  for (const b of buildings) {
    if (Math.abs(u - b.u) <= b.w / 2 && Math.abs(v - b.v) <= b.d / 2) return b;
  }
  return null;
}

function treeAt(u, v) {
  const bu = Math.floor(u / BUCKET);
  const bv = Math.floor(v / BUCKET);
  for (let du = -1; du <= 1; du++) {
    for (let dv = -1; dv <= 1; dv++) {
      for (const t of treeBuckets.get(`${bu + du},${bv + dv}`) ?? []) {
        if (Math.hypot(u - t.u, v - t.v) <= t.r) return t;
      }
    }
  }
  return null;
}

/* ---------- build ---------- */

const colorPixels = Buffer.alloc(SIZE * SIZE * 3);
const heightPixels = Buffer.alloc(SIZE * SIZE);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Pixel → layout coordinates: 0..1 is the middle square, and the
    // margin runs past it on every side.
    const u = LOW + ((x + 0.5) / SIZE) * EXTENT;
    const v = LOW + ((y + 0.5) / SIZE) * EXTENT;

    let height;
    let color;

    const building = buildingAt(u, v);
    const lake = lakeAmount(u, v);
    const city = cityAmount(u, v);

    if (building) {
      height = building.height;
      color = building.color;
    } else if (city > 0.5 && overlapsBuilding(u, v, 0, 0, PAVING)) {
      // Paving only right around each building; grass fills the gaps.
      height = PLAZA;
      color = COLORS.plaza;
    } else if (onRoad(u, v)) {
      // Roads follow the hills, easing down to the plaza like the grass does.
      const grass = grassHeight(u, v);
      height = grass + (PLAZA - grass) * city * 2;
      color = COLORS.road;
    } else if (lake > 0.02) {
      const grass = grassHeight(u, v);
      height = grass + (LAKE_FLOOR - grass) * Math.min(lake * 1.6, 1);
      color = mix(COLORS.lakeShallow, COLORS.lakeDeep, smoothstep(0.1, 0.9, lake));
    } else {
      const grass = grassHeight(u, v);
      // Ease the hills down into the plaza at the city's edge.
      height = grass + (PLAZA - grass) * city * 2;
      const t = smoothstep(GRASS_BASE, GRASS_BASE + GRASS_HILLS + FRONT_HILL_HEIGHT, height);
      const grain = (fbm(u * 60, v * 60, 2) - 0.5) * 0.12;
      color = mix(COLORS.grassLow, COLORS.grassHigh, Math.min(Math.max(t + grain, 0), 1));

      if (treeAt(u, v)) {
        height += TREE;
        color = COLORS.tree;
      }
    }

    const i = y * SIZE + x;
    heightPixels[i] = Math.round(Math.min(Math.max(height, 0), 1) * 255);
    colorPixels[i * 3] = Math.round(color[0] * 255);
    colorPixels[i * 3 + 1] = Math.round(color[1] * 255);
    colorPixels[i * 3 + 2] = Math.round(color[2] * 255);
  }
}

mkdirSync('assets', { recursive: true });
const colorPng = encodePng(SIZE, SIZE, 3, colorPixels);
const heightPng = encodePng(SIZE, SIZE, 1, heightPixels);

writeFileSync('assets/color-map.png', colorPng);
writeFileSync('assets/height-map.png', heightPng);

console.log(`${buildings.length} towers, ${trees.length} trees`);
console.log(`color-map.png   ${SIZE}x${SIZE}  ${(colorPng.length / 1024).toFixed(1)} kB`);
console.log(`height-map.png  ${SIZE}x${SIZE}  ${(heightPng.length / 1024).toFixed(1)} kB`);
