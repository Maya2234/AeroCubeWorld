/* =====================================================================
   make-landscape-maps.mjs — Level 2 image pair that matches Level 1.

   Run it with:   node tools/make-landscape-maps.mjs
   It writes:     assets/color-map.png    (RGB colours)
                  assets/height-map.png   (grayscale heights)

   Uses the same noise, height curve and palette as heightField() and
   paletteColor() in index.js, so Level 2 draws the same landscape as
   Level 1b/c. HILLS and HEIGHT_RATIO are read straight out of index.js;
   if you change the noise, the curve or PALETTE there, change them here
   too and run this again.
   ===================================================================== */

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SIZE = 512;          // source resolution; grid resolutions sample down from this

const source = readFileSync('index.js', 'utf8');

function readConstant(name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`));
  if (!match) throw new Error(`Could not find ${name} in index.js`);
  return Number(match[1]);
}

const HILLS = readConstant('HILLS');
const HEIGHT_RATIO = readConstant('HEIGHT_RATIO');

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

/* ---------- terrain: copied from index.js ---------- */

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
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

function fbm(x, y) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < 4; octave++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency);
    total += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return sum / total;
}

const PALETTE = [
  [0.07, 0.16, 0.34],
  [0.09, 0.40, 0.47],
  [0.36, 0.63, 0.36],
  [0.93, 0.88, 0.70],
];

function paletteColor(t) {
  const clamped = Math.min(Math.max(t, 0), 1);
  const scaled = clamped * (PALETTE.length - 1);
  const index = Math.min(Math.floor(scaled), PALETTE.length - 2);
  const f = scaled - index;
  const smooth = f * f * (3 - 2 * f);
  const a = PALETTE[index];
  const b = PALETTE[index + 1];
  return [
    a[0] + (b[0] - a[0]) * smooth,
    a[1] + (b[1] - a[1]) * smooth,
    a[2] + (b[2] - a[2]) * smooth,
  ];
}

/* ---------- build ---------- */

// h is 0..1, the same number heightField() maps onto [shortest, tallest].
// Level 2 maps brightness onto that same range, so the height map stores h.
const heights = new Float32Array(SIZE * SIZE);
let maxH = 0;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Image column = grid i (x axis), image row = grid j (z axis).
    const u = (x + 0.5) / SIZE;
    const v = (y + 0.5) / SIZE;
    const h = Math.pow(fbm(u * HILLS, v * HILLS), 1.8);
    heights[y * SIZE + x] = h;
    if (h > maxH) maxH = h;
  }
}

// Level 1 colours a cube's top by height / peak, where both include the
// `shortest` floor. In units of `tallest` that floor is 0.012 / HEIGHT_RATIO.
const floor = 0.012 / HEIGHT_RATIO;
const peak = floor + maxH * (1 - floor);

const colorPixels = Buffer.alloc(SIZE * SIZE * 3);
const heightPixels = Buffer.alloc(SIZE * SIZE);

for (let i = 0; i < SIZE * SIZE; i++) {
  const h = heights[i];
  const [r, g, b] = paletteColor((floor + h * (1 - floor)) / peak);
  colorPixels[i * 3] = Math.round(r * 255);
  colorPixels[i * 3 + 1] = Math.round(g * 255);
  colorPixels[i * 3 + 2] = Math.round(b * 255);
  heightPixels[i] = Math.round(h * 255);
}

mkdirSync('assets', { recursive: true });
const colorPng = encodePng(SIZE, SIZE, 3, colorPixels);
const heightPng = encodePng(SIZE, SIZE, 1, heightPixels);

writeFileSync('assets/color-map.png', colorPng);
writeFileSync('assets/height-map.png', heightPng);

console.log(`HILLS = ${HILLS}, HEIGHT_RATIO = ${HEIGHT_RATIO}`);
console.log(`color-map.png   ${SIZE}x${SIZE}  ${(colorPng.length / 1024).toFixed(1)} kB`);
console.log(`height-map.png  ${SIZE}x${SIZE}  ${(heightPng.length / 1024).toFixed(1)} kB`);
console.log(`tallest point: ${Math.round(maxH * 255)} of 255`);
