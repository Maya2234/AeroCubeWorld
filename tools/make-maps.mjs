/* =====================================================================
   make-maps.mjs — generates the mock Level 2 image pair.

   Run it with:   node tools/make-maps.mjs
   It writes:     assets/color-map.png    (RGB colours)
                  assets/height-map.png   (grayscale heights)

   The two images are generated from the SAME height array, which is the
   whole point of the exercise: the colour of a spot and the height of a
   spot are two views of one number, so they cannot drift out of alignment.

   No dependencies: PNG is just a few chunks and a zlib stream, both of
   which Node ships with.
   ===================================================================== */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZE = 512;          // source resolution; grid resolutions sample down from this
const SEED = 20261024;     // change this for a different island

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
  const colorType = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const stride = width * channels;

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;          // bit depth
  header[9] = colorType;  // 0 = grayscale, 2 = RGB, 6 = RGBA
  header[10] = 0;         // deflate
  header[11] = 0;         // adaptive filtering
  header[12] = 0;         // no interlacing

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

/* ---------- terrain ---------- */

function makeNoise(seed) {
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 0.0001) * 43758.5453;
    return s - Math.floor(s);
  };

  const valueNoise = (x, y) => {
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
  };

  return (x, y, octaves = 5) => {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * valueNoise(x * frequency, y * frequency);
      total += amplitude;
      frequency *= 2;
      amplitude *= 0.5;
    }
    return sum / total;
  };
}

const fbm = makeNoise(SEED);

// Smooth 0..1 ramp, used for the coastline falloff.
function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function heightAt(u, v) {
  // Distance from the middle, warped slightly so the coast isn't a circle.
  const dx = u - 0.5;
  const dy = v - 0.5;
  const warp = (fbm(u * 3.1 + 11.3, v * 3.1 + 4.7, 3) - 0.5) * 0.16;
  const distance = Math.hypot(dx, dy * 1.05) + warp;

  // 1 in the middle, 0 at the edges.
  const island = 1 - smoothstep(0.14, 0.46, distance);

  const hills = fbm(u * 4.4, v * 4.4, 5);
  const detail = fbm(u * 13.0 + 7.7, v * 13.0 + 2.2, 4);

  // Sea floor is near zero, land rises to a ridge near the middle.
  const land = island * (0.34 + 0.52 * hills + 0.14 * detail);
  const shelf = 0.055 * (1 - island);           // shallow sea floor
  return Math.min(Math.max(land + shelf, 0), 1);
}

/* ---------- colour ramp ---------- */

const STOPS = [
  [0.00, [8, 28, 58]],      // deep water
  [0.16, [16, 62, 96]],     // water
  [0.30, [32, 104, 122]],   // shallows
  [0.36, [214, 199, 146]],  // sand
  [0.44, [104, 146, 78]],   // lowland grass
  [0.58, [62, 112, 58]],    // forest
  [0.72, [122, 122, 112]],  // rock
  [0.86, [196, 198, 202]],  // bare rock
  [0.95, [244, 248, 252]],  // snow
];

function colourAt(h) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i];
    const [t1, c1] = STOPS[i + 1];
    if (h <= t1) {
      const f = (h - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/* ---------- build ---------- */

const colorPixels = Buffer.alloc(SIZE * SIZE * 3);
const heightPixels = Buffer.alloc(SIZE * SIZE);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const u = (x + 0.5) / SIZE;
    const v = (y + 0.5) / SIZE;
    const h = heightAt(u, v);

    // A little per-pixel variation so flat areas aren't one flat colour.
    const grain = (fbm(u * 90, v * 90, 2) - 0.5) * 14;
    const [r, g, b] = colourAt(h);
    const index = (y * SIZE + x) * 3;
    colorPixels[index] = Math.min(Math.max(r + grain, 0), 255);
    colorPixels[index + 1] = Math.min(Math.max(g + grain, 0), 255);
    colorPixels[index + 2] = Math.min(Math.max(b + grain, 0), 255);

    heightPixels[y * SIZE + x] = Math.round(h * 255);
  }
}

mkdirSync('assets', { recursive: true });
const colorPng = encodePng(SIZE, SIZE, 3, colorPixels);
const heightPng = encodePng(SIZE, SIZE, 1, heightPixels);

writeFileSync('assets/color-map.png', colorPng);
writeFileSync('assets/height-map.png', heightPng);

let min = 255;
let max = 0;
for (const value of heightPixels) {
  if (value < min) min = value;
  if (value > max) max = value;
}

console.log(`color-map.png   ${SIZE}x${SIZE}  ${(colorPng.length / 1024).toFixed(1)} kB`);
console.log(`height-map.png  ${SIZE}x${SIZE}  ${(heightPng.length / 1024).toFixed(1)} kB`);
console.log(`height range in the map: ${min}..${max} of 255`);
