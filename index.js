/* =====================================================================
   Cube landscape — Levels 0 to 3

   Where each part of the project lives in this file:
     0   buildSingleCube() 
     1a  buildGrid()      
     1b  heightField()    — scaling: the noise procedure that picks heights
     1c  paletteColor()   — colour per VERTEX, interpolated by the GPU
     1d  cameraFor()      — the camera orbiting its look-at point
     2   buildImageGrid() — heights and colours read from a PNG pair
     3   drawSky()        — cube islands drifting along bezier curves

   The landscape is one interleaved buffer, drawn with a single
   gl.drawArrays call. That is what keeps 16,000+ cubes fast. Level 3 adds
   one small buffer per sky object, each drawn with its own uModel matrix.
   ===================================================================== */

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl');
const statusEl = document.getElementById('status');
const taglineEl = document.getElementById('tagline');
const resGroup = document.getElementById('res');
const levelButtons = [...document.querySelectorAll('.levels button')];
const resButtons = [...document.querySelectorAll('#res button')];

if (!gl) {
  statusEl.textContent = 'WebGL is not available in this browser.';
  throw new Error('WebGL unavailable');
}

/* ---------------------------------------------------------------------
   1. Shaders
   --------------------------------------------------------------------- */

// The landscape's vertices arrive already in world space (translation and
// scale are baked in while the buffer is built), so its uModel is the
// identity. Sky objects keep a small local buffer and get a real uModel.
const vertexShaderSource = `
  attribute vec3 aPosition;   // corner position, in the object's own space
  attribute vec3 aNormal;     // which way the face points
  attribute vec3 aColor;      // this corner's colour, 0..1 per channel

  uniform mat4 uModel;        // object → world. Identity for the landscape;
                              // translation + rotation + scale for sky objects.
  uniform mat4 uView;
  uniform mat4 uProjection;

  varying vec3 vNormal;       // interpolated, then handed to the fragment shader
  varying vec3 vColor;

  void main() {
    // mat3(uModel) rotates the normal along with the object. Sky objects are
    // only translated, rotated and evenly scaled, so the direction stays right.
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  varying vec3 vNormal;
  varying vec3 vColor;

  void main() {
    // A varying is blended across the triangle, so its length changes.
    // Normalising it brings it back to a unit direction.
    vec3 normal = normalize(vNormal);

    // Light from above and slightly to the side.
    vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.3));
    float brightness = max(dot(normal, lightDirection), 0.0);

    // 30% ambient so faces pointing away from the light aren't black.
    float light = 0.3 + 0.7 * brightness;

    // THE KEY LINE FOR 1c: the GPU has already blended vColor between this
    // triangle's three corners for us, so each pixel gets its own colour.
    gl_FragColor = vec4(vColor * light, 1.0);
  }
`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

const program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexShaderSource));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
gl.linkProgram(program);
gl.useProgram(program);

/* ---------------------------------------------------------------------
   unit cube
   36 vertices: 12 triangles. Each vertex is 6 floats:
   position (x, y, z) then normal (nx, ny, nz)
   1×1×1
   base y = 0
   --------------------------------------------------------------------- */

const CUBE = new Float32Array([
  // Front face (+z)
  -0.5, 0, 0.5,   0, 0, 1,
   0.5, 0, 0.5,   0, 0, 1,
   0.5, 1, 0.5,   0, 0, 1,
  -0.5, 0, 0.5,   0, 0, 1,
   0.5, 1, 0.5,   0, 0, 1,
  -0.5, 1, 0.5,   0, 0, 1,

  // Back face (-z)
  -0.5, 0, -0.5,  0, 0, -1,
   0.5, 1, -0.5,  0, 0, -1,
   0.5, 0, -0.5,  0, 0, -1,
  -0.5, 0, -0.5,  0, 0, -1,
  -0.5, 1, -0.5,  0, 0, -1,
   0.5, 1, -0.5,  0, 0, -1,

  // Top face (+y)
  -0.5, 1, -0.5,  0, 1, 0,
  -0.5, 1,  0.5,  0, 1, 0,
   0.5, 1,  0.5,  0, 1, 0,
  -0.5, 1, -0.5,  0, 1, 0,
   0.5, 1,  0.5,  0, 1, 0,
   0.5, 1, -0.5,  0, 1, 0,

  // Bottom face (-y)
  -0.5, 0, -0.5,  0, -1, 0,
   0.5, 0,  0.5,  0, -1, 0,
  -0.5, 0,  0.5,  0, -1, 0,
  -0.5, 0, -0.5,  0, -1, 0,
   0.5, 0, -0.5,  0, -1, 0,
   0.5, 0,  0.5,  0, -1, 0,

  // Right face (+x)
   0.5, 0, -0.5,  1, 0, 0,
   0.5, 1, -0.5,  1, 0, 0,
   0.5, 1,  0.5,  1, 0, 0,
   0.5, 0, -0.5,  1, 0, 0,
   0.5, 1,  0.5,  1, 0, 0,
   0.5, 0,  0.5,  1, 0, 0,

  // Left face (-x)
  -0.5, 0, -0.5, -1, 0, 0,
  -0.5, 1,  0.5, -1, 0, 0,
  -0.5, 1, -0.5, -1, 0, 0,
  -0.5, 0, -0.5, -1, 0, 0,
  -0.5, 0,  0.5, -1, 0, 0,
  -0.5, 1,  0.5, -1, 0, 0,
]);

const VERTS_PER_CUBE = 36;
const FLOATS_PER_VERTEX = 9;               // position 3 + normal 3 + colour 3
const BYTES_PER_FLOAT = 4;
const STRIDE = FLOATS_PER_VERTEX * BYTES_PER_FLOAT;

/* ---------------------------------------------------------------------
   Matrix helpers
   --------------------------------------------------------------------- */

// Move a point by (x, y, z).
function translation(x, y, z) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

// Rotate around the y axis (up), which is all a drifting sky object needs.
function rotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
     c, 0, -s, 0,
     0, 1,  0, 0,
     s, 0,  c, 0,
     0, 0,  0, 1,
  ];
}

// Stretch a point by (sx, sy, sz).
function scaling(sx, sy, sz) {
  return [
    sx, 0,  0,  0,
    0,  sy, 0,  0,
    0,  0,  sz, 0,
    0,  0,  0,  1,
  ];
}

// Multiply two matrices: the result does b first, then a.
function multiply(a, b) {
  const result = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) {
        result[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
  }
  return result;
}

// Perspective projection: far-away things look smaller.
function perspective(fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2);
  return [
    f / aspect, 0, 0,                               0,
    0,          f, 0,                               0,
    0,          0, (far + near) / (near - far),    -1,
    0,          0, (2 * far * near) / (near - far), 0,
  ];
}

// Camera matrix: place a camera at `eye`, looking at `target`, with `up`
// pointing up. Rebuilding this every frame from a moving eye is what makes
// the orbit in Level 1d work.
function lookAt(eye, target, up) {
  const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalize = (a) => {
    const length = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / length, a[1] / length, a[2] / length];
  };

  const zAxis = normalize(subtract(eye, target)); // backwards, away from the target
  const xAxis = normalize(cross(up, zAxis));      // the camera's right
  const yAxis = cross(zAxis, xAxis);              // the camera's up

  return [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1,
  ];
}

/* ---------------------------------------------------------------------
   Level 1b — add height
   ---------------------------------------------------------------------
   A height map from noise. valueNoise() gives a smooth blob between four
   random lattice points; fbm() ("fractal Brownian motion") adds several
   sizes of blob together so the terrain has hills inside hills.

   The noise is sampled in GRID coordinates (0..1 across the landscape),
   not world coordinates, so every resolution shows the SAME landscape —
   just sampled more or less finely. That is what makes the resolution
   buttons comparable.
   --------------------------------------------------------------------- */

const SPACING = 1;              // world units between neighbouring cube centres
const HILLS = 8;              // how many big hills across the terrain
const HEIGHT_RATIO = 0.14;      // tallest cube, as a fraction of terrain width

// Deterministic pseudo-random number for one lattice point: same (x, y)
// always gives the same value, so the landscape doesn't change per reload.
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Smooth value noise in the range 0..1.
function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  // Smoothstep the fractions so the blobs join without visible creases.
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  // The four corners of this lattice cell.
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);

  // Blend along x, twice, then blend those two results along y.
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

// Four octaves: big hills + smaller hills + fine bumps.
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
  return sum / total;          // back into 0..1
}

// One height per grid cell, in world units.
function heightField(n) {
  const span = n * SPACING;
  const tallest = span * HEIGHT_RATIO;
  const shortest = span * 0.012;
  const heights = new Float32Array(n * n);
  let peak = 0;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);      // 0 on one edge, 1 on the other
      const v = j / (n - 1);
      let h = fbm(u * HILLS, v * HILLS);
      h = Math.pow(h, 1.8);       // widen the valleys, sharpen the peaks
      const height = shortest + h * (tallest - shortest);
      heights[j * n + i] = height;
      if (height > peak) peak = height;
    }
  }

  return { heights, peak: peak || tallest };
}

/* ---------------------------------------------------------------------
   5. Level 1c — the colour procedure
   ---------------------------------------------------------------------
   Four stops from valley floor to peak. Each cube corner gets the colour
   for its OWN height, so the six faces blend from dark at the base to the
   colour of that cube's top. That blend is the interpolation the fragment
   shader does for free.
   --------------------------------------------------------------------- */

const PALETTE = [
  [0.07, 0.16, 0.34],   // 0.00  deepest hollows
  [0.09, 0.40, 0.47],   // 0.33  lowland
  [0.36, 0.63, 0.36],   // 0.66  slopes
  [0.93, 0.88, 0.70],   // 1.00  peaks
];

const vertexColor = [0, 0, 0];

function paletteColor(t, out) {
  const clamped = Math.min(Math.max(t, 0), 1);
  const scaled = clamped * (PALETTE.length - 1);
  const index = Math.min(Math.floor(scaled), PALETTE.length - 2);
  const f = scaled - index;
  const smooth = f * f * (3 - 2 * f);          // ease in/out between stops
  const a = PALETTE[index];
  const b = PALETTE[index + 1];
  out[0] = a[0] + (b[0] - a[0]) * smooth;
  out[1] = a[1] + (b[1] - a[1]) * smooth;
  out[2] = a[2] + (b[2] - a[2]) * smooth;
  return out;
}

/* ---------------------------------------------------------------------
   6. Building the buffer
   --------------------------------------------------------------------- */

const level1a_COLOR = [0.40, 0.55, 0.80];
const level0_COLOR = [0.86, 0.47, 0.30]; 

// Write one transformed cube into `data` starting at float index `start`.
// `model` is translation × scaling, exactly as in Level 0, but applied here
// on the CPU instead of per-draw-call on the GPU.
function writeCube(data, start, model, colorMode, peak, flatColor) {
  let o = start;

  for (let v = 0; v < VERTS_PER_CUBE; v++) {
    const px = CUBE[v * 6 + 0];
    const py = CUBE[v * 6 + 1];
    const pz = CUBE[v * 6 + 2];

    // model × vertex, written out by hand (column-major: the translation
    // lives in elements 12, 13 and 14).
    const wx = model[0] * px + model[4] * py + model[8] * pz + model[12];
    const wy = model[1] * px + model[5] * py + model[9] * pz + model[13];
    const wz = model[2] * px + model[6] * py + model[10] * pz + model[14];

    data[o++] = wx;
    data[o++] = wy;
    data[o++] = wz;

    // Normals don't need transforming: these cubes are only stretched along
    // the axes, never rotated, so an axis-aligned normal stays correct.
    data[o++] = CUBE[v * 6 + 3];
    data[o++] = CUBE[v * 6 + 4];
    data[o++] = CUBE[v * 6 + 5];

    if (colorMode === 'height') {
      paletteColor(wy / peak, vertexColor);
      data[o++] = vertexColor[0];
      data[o++] = vertexColor[1];
      data[o++] = vertexColor[2];
    } else {
      data[o++] = flatColor[0];
      data[o++] = flatColor[1];
      data[o++] = flatColor[2];
    }
  }

  return o;
}

// Level 1a / 1b / 1c: an n × n grid on the x–z plane.
function buildGrid(n, options) {
  const { heights: useHeights, colors: colorMode } = options;
  const field = useHeights ? heightField(n) : null;
  const cells = n * n;
  const data = new Float32Array(cells * VERTS_PER_CUBE * FLOATS_PER_VERTEX);
  const half = (n - 1) / 2;
  let offset = 0;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // 1a — TRANSLATION: spread the cells evenly across the plane and keep
      // the whole grid centred on the origin.
      const x = (i - half) * SPACING;
      const z = (j - half) * SPACING;

      // 1b — SCALING: stretch in y only. With heights off (Level 1a) every
      // cube is a 1×1×1 unit cube, so the grid reads as a flat plane.
      const height = useHeights ? field.heights[j * n + i] : 1;

      // The order matters: scale first, then move. multiply(a, b) runs b
      // first, so scaling goes on the right.
      const model = multiply(translation(x, 0, z), scaling(1, height, 1));

      offset = writeCube(
        data,
        offset,
        model,
        colorMode,
        field ? field.peak : 1,
        level1a_COLOR,
      );
    }
  }

  return {
    data,
    vertexCount: cells * VERTS_PER_CUBE,
    cubes: cells,
    span: n * SPACING,
  };
}

/* ---------------------------------------------------------------------
   6b. Level 2 — heights and colours from image data
   ---------------------------------------------------------------------
   Two PNGs: a colour map, and a grayscale height map of the same size.
   Browsers only hand pixels to JavaScript through a canvas, so each image
   is drawn into an off-screen canvas once and its ImageData is kept.

   The grid is usually coarser than the image (a 32 × 32 grid over a
   512 × 512 map covers 16 × 16 pixels per cube), so each cell AVERAGES
   the pixels it covers instead of picking one. That keeps thin features
   from disappearing whenever the resolution changes.
   --------------------------------------------------------------------- */

const IMAGE_MAP = {
  color: null,        // { pixels, width, height }
  height: null,
  status: 'loading',  // loading | ready | failed
};

function loadPixels(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      // Draw at naturalWidth/Height: CSS-sized pixels would lose detail.
      const surface = document.createElement('canvas');
      surface.width = image.naturalWidth;
      surface.height = image.naturalHeight;
      const context = surface.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      try {
        const data = context.getImageData(0, 0, surface.width, surface.height);
        resolve({ pixels: data.data, width: surface.width, height: surface.height });
      } catch (error) {
        // A cross-origin image taints the canvas and this throws.
        reject(error);
      }
    };
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

// Average one channel over the pixel block that a grid cell covers.
// u0..u1 and v0..v1 are in 0..1 image space, v measured from the BOTTOM.
function averageChannel(image, u0, u1, v0, v1, channel) {
  const { pixels, width, height } = image;

  let x0 = Math.floor(u0 * width);
  let x1 = Math.ceil(u1 * width);
  let y0 = Math.floor((1 - v1) * height);
  let y1 = Math.ceil((1 - v0) * height);

  x0 = Math.min(Math.max(x0, 0), width - 1);
  y0 = Math.min(Math.max(y0, 0), height - 1);
  x1 = Math.min(Math.max(x1, x0 + 1), width);
  y1 = Math.min(Math.max(y1, y0 + 1), height);

  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += pixels[(y * width + x) * 4 + channel];
      count++;
    }
  }

  return count ? sum / count / 255 : 0;   // 0..1
}

const cellColor = [0, 0, 0];

function sampleCellColor(image, u0, u1, v0, v1, out) {
  out[0] = averageChannel(image, u0, u1, v0, v1, 0);
  out[1] = averageChannel(image, u0, u1, v0, v1, 1);
  out[2] = averageChannel(image, u0, u1, v0, v1, 2);
  return out;
}

// 0 = sea level, 1 = the tallest sample. One number per grid cell.
const IMAGE_HEIGHT_GAMMA = 1.0;

// Level 2: the grid, built from the two images instead of from noise.
// Returns null until the PNGs have finished decoding.
function buildImageGrid(n) {
  if (IMAGE_MAP.status !== 'ready') return null;

  const { color, height } = IMAGE_MAP;
  const cells = n * n;
  const data = new Float32Array(cells * VERTS_PER_CUBE * FLOATS_PER_VERTEX);
  const half = (n - 1) / 2;
  const span = n * SPACING;
  const shortest = span * 0.012;          // sea floor: low, but never zero
  const tallest = span * HEIGHT_RATIO;
  let offset = 0;

  for (let j = 0; j < n; j++) {
    // Image row 0 is the top of the picture. Flipping v maps it to the far
    // edge of the grid instead of mirroring the island north-to-south.
    const v0 = 1 - (j + 1) / n;
    const v1 = 1 - j / n;

    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;

      // Height: average brightness, then map 0..1 onto real world heights.
      const brightness = averageChannel(height, u0, u1, v0, v1, 0);
      const h = shortest +
        Math.pow(brightness, IMAGE_HEIGHT_GAMMA) * (tallest - shortest);

      // Colour: average RGB over the same footprint.
      sampleCellColor(color, u0, u1, v0, v1, cellColor);

      const x = (i - half) * SPACING;
      const z = (j - half) * SPACING;
      const model = multiply(translation(x, 0, z), scaling(1, h, 1));

      // 'flat' means every corner of this cube gets the same colour, so the
      // image detail replaces Level 1's per-vertex height gradient.
      offset = writeCube(data, offset, model, 'flat', 1, cellColor);
    }
  }

  return {
    data,
    vertexCount: cells * VERTS_PER_CUBE,
    cubes: cells,
    span,
  };
}

// Start loading immediately; the level 2 tab rebuilds itself when ready.
Promise.all([
  loadPixels('assets/color-map.png'),
  loadPixels('assets/height-map.png'),
]).then(([color, height]) => {
  IMAGE_MAP.color = color;
  IMAGE_MAP.height = height;
  IMAGE_MAP.status = 'ready';

  if (MODES[state.mode].maps) {
    rebuild();
    restartRendering();
    updateStatus();
  }
}).catch((error) => {
  IMAGE_MAP.status = 'failed';
  console.warn('Level 2 maps failed to load:', error);
  updateStatus();
});

// Level 0: one cube measuring 2 × 2 × 2, centred on the origin.
function buildSingleCube() {
  const data = new Float32Array(VERTS_PER_CUBE * FLOATS_PER_VERTEX);
  const model = multiply(translation(0, 0, 0), scaling(2, 2, 2));
  writeCube(data, 0, model, 'flat', 1, level0_COLOR);
  return { data, vertexCount: VERTS_PER_CUBE, cubes: 1, span: 2 };
}

/* ---------------------------------------------------------------------
   6c. Level 3 — a skyscape of cube objects on bezier curves
   ---------------------------------------------------------------------
   Each object is a little cluster of cubes, built ONCE in its own local
   space (a few units across). At draw time the GPU is handed a model
   matrix that scales the cluster to the landscape, spins it and moves it
   along a cubic bezier curve.

   Keeping each cluster in its own buffer means the landscape still costs
   one draw call, and five sky objects add only five more.
   --------------------------------------------------------------------- */

const SKY_COLORS = {
  grass: [0.33, 0.55, 0.34],
  dirt: [0.30, 0.24, 0.19],
  leaf: [0.26, 0.60, 0.32],
  trunk: [0.36, 0.26, 0.18],
  cloud: [0.86, 0.89, 0.94],
  cloudShade: [0.70, 0.76, 0.85],
  bird: [0.16, 0.18, 0.22],
};

// Pack a list of cubes into one interleaved buffer. Per-cube scale can be a
// single number (`size`) or one per axis (sx/sy/sz) for flat things.
function buildCluster(cubes) {
  const data = new Float32Array(cubes.length * VERTS_PER_CUBE * FLOATS_PER_VERTEX);
  let offset = 0;

  for (const cube of cubes) {
    const model = multiply(
      translation(cube.x, cube.y, cube.z),
      scaling(
        cube.sx ?? cube.size,
        cube.sy ?? cube.size,
        cube.sz ?? cube.size,
      ),
    );
    offset = writeCube(data, offset, model, 'flat', 1, cube.color);
  }

  return { data, vertexCount: cubes.length * VERTS_PER_CUBE };
}

// A floating island: a 3 × 3 grassy top, a tapered rocky underside and a tree.
const ISLAND_CUBES = (() => {
  const cubes = [];

  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      cubes.push({ x: x * 1.05, y: 0, z: z * 1.05, size: 1, color: SKY_COLORS.grass });
    }
  }

  cubes.push({ x: 0, y: -0.75, z: 0, size: 0.9, color: SKY_COLORS.dirt });
  cubes.push({ x: -0.7, y: -0.55, z: 0.1, size: 0.55, color: SKY_COLORS.dirt });
  cubes.push({ x: 0.7, y: -0.6, z: -0.15, size: 0.5, color: SKY_COLORS.dirt });
  cubes.push({ x: 0, y: -1.3, z: 0.05, size: 0.45, color: SKY_COLORS.dirt });

  cubes.push({ x: 1.0, y: 1, z: -0.4, size: 0.22, color: SKY_COLORS.trunk });
  cubes.push({ x: 1.0, y: 1.2, z: -0.4, size: 0.62, color: SKY_COLORS.leaf });

  return cubes;
})();

// A blocky cloud: overlapping cubes at slightly different heights.
const CLOUD_CUBES = [
  { x: -0.9, y: 0, z: 0, size: 0.9, color: SKY_COLORS.cloud },
  { x: 0, y: 0.1, z: 0.15, size: 1.2, color: SKY_COLORS.cloud },
  { x: 0.85, y: -0.05, z: -0.1, size: 0.8, color: SKY_COLORS.cloudShade },
  { x: 0.15, y: 0.85, z: 0, size: 0.7, color: SKY_COLORS.cloud },
  { x: -0.55, y: 0.8, z: 0.05, size: 0.5, color: SKY_COLORS.cloudShade },
];

// A bird: a body, two flat wings and a head.
const BIRD_CUBES = [
  { x: 0, y: 0, z: 0, sx: 0.55, sy: 0.22, sz: 0.22, color: SKY_COLORS.bird },
  { x: -0.55, y: 0.02, z: 0, sx: 0.55, sy: 0.06, sz: 0.3, color: SKY_COLORS.bird },
  { x: 0.55, y: 0.02, z: 0, sx: 0.55, sy: 0.06, sz: 0.3, color: SKY_COLORS.bird },
  { x: 0, y: 0.18, z: 0, size: 0.16, color: SKY_COLORS.bird },
];

// Everything that moves. Coordinates are fractions of the landscape width, so
// the same scene works at every grid resolution.
const SKY_DEFINITIONS = [
  {
    name: 'island',
    cubes: ISLAND_CUBES,
    // Long enough that both ends of the curve are outside the frame: the
    // island flies in from the left and leaves on the right.
    path: [
      [-1.62, 0.33, 0.55],
      [-0.50, 0.43, 0.50],
      [0.40, 0.31, -0.30],
      [1.20, 0.37, -1.55],
    ],
    scale: 0.075,
    speed: 0.018,     // fraction of the curve per second → 55 s per pass
    phase: 0,
    spin: 0.12,       // radians per second
    hideAfter: 1,
  },
  {
    name: 'cloud A',
    cubes: CLOUD_CUBES,
    path: [
      [-1.45, 0.42, 0.75],
      [-0.40, 0.48, 0.10],
      [0.30, 0.38, -0.50],
      [1.05, 0.44, -1.40],
    ],
    scale: 0.055,
    speed: 0.028,
    phase: 0.35,
    spin: 0.05,
    hideAfter: 1,
  },
  {
    name: 'cloud B',
    cubes: CLOUD_CUBES,
    path: [
      [-0.70, 0.54, 0.10],
      [-0.20, 0.47, -0.30],
      [0.40, 0.35, -0.70],
      [1.15, 0.37, -1.35],
    ],
    scale: 0.040,
    speed: 0.021,
    phase: 0.70,
    spin: 0.04,
    hideAfter: 1,
  },
  {
    name: 'bird A',
    cubes: BIRD_CUBES,
    path: [
      [-1.62, 0.22, 0.55],
      [-0.50, 0.32, 0.20],
      [0.40, 0.18, -0.50],
      [1.25, 0.26, -1.50],
    ],
    scale: 0.028,
    speed: 0.09,      // 11 s per pass
    phase: 0,
    spin: 0,
    hideAfter: 1,
  },
  {
    name: 'bird B',
    cubes: BIRD_CUBES,
    path: [
      [-1.62, 0.22, 0.55],
      [-0.50, 0.32, 0.20],
      [0.40, 0.18, -0.50],
      [1.25, 0.26, -1.50],
    ],
    scale: 0.023,
    speed: 0.09,
    phase: 0.12,      // a little behind bird A, so they read as a pair
    spin: 0,
    hideAfter: 1,
  },
];

// Cubic bezier: a curve from p0 to p3, pulled toward p1 and p2.
//   B(t) = (1-t)³·p0 + 3(1-t)²t·p1 + 3(1-t)t²·p2 + t³·p3
// The four weights always sum to 1, so the result is a weighted average of
// the control points: t = 0 sits on p0, t = 1 sits on p3.
function bezierPoint(points, t) {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;

  return [
    b0 * points[0][0] + b1 * points[1][0] + b2 * points[2][0] + b3 * points[3][0],
    b0 * points[0][1] + b1 * points[1][1] + b2 * points[2][1] + b3 * points[3][1],
    b0 * points[0][2] + b1 * points[1][2] + b2 * points[2][2] + b3 * points[3][2],
  ];
}

function createSkyObjects() {
  return SKY_DEFINITIONS.map((definition) => {
    const built = buildCluster(definition.cubes);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW);
    return { ...definition, buffer, vertexCount: built.vertexCount };
  });
}

const SKY_OBJECTS = createSkyObjects();

const skyPosition = [0, 0, 0];

function drawSky(time) {
  const span = state.span;

  for (const object of SKY_OBJECTS) {
    const t = (time * object.speed + object.phase) % 1;
    if (t > object.hideAfter) continue;   // safety hatch; paths end off-screen

    const p = bezierPoint(object.path, t);
    const size = span * object.scale;

    // Scale the little cluster up, spin it, then move it onto the curve.
    // multiply(a, b) runs b first, so this reads right-to-left: S → R → T.
    const model = multiply(
      translation(p[0] * span, p[1] * span, p[2] * span),
      multiply(
        rotationY(time * object.spin + object.phase * Math.PI * 2),
        scaling(size, size, size),
      ),
    );

    gl.uniformMatrix4fv(uModel, false, model);
    useGeometry(object.buffer);
    gl.drawArrays(gl.TRIANGLES, 0, object.vertexCount);
  }
}

/* ---------------------------------------------------------------------
   7. Scene state
   --------------------------------------------------------------------- */

const MODES = {
  '0': {
    tagline: 'One cube, 2 × 2 × 2, sitting at the origin.',
    orbit: false,
    heights: false,
    colors: 'flat',
  },
  '1a': {
    tagline: 'Translation only: unit cubes laid out in a grid on the x–z plane.',
    orbit: false,
    heights: false,
    colors: 'flat',
  },
  '1bc': {
    tagline: 'Scaling and colour: each cube stretched in y, its corners coloured by height.',
    orbit: false,
    heights: true,
    colors: 'height',
  },
  '1d': {
    tagline: 'The finished landscape, with the camera orbiting its centre.',
    orbit: true,
    animated: true,
    heights: true,
    colors: 'height',
  },
  '2': {
    tagline: 'Image data: heights and colours sampled from a PNG pair, not from noise.',
    orbit: false,
    heights: true,
    colors: 'image',
    maps: true,
  },
  '3': {
    tagline: 'Skyscape: cube islands and clouds drifting along cubic bezier curves.',
    orbit: false,       // the camera stays put; only the sky objects move
    animated: true,
    heights: true,
    colors: 'height',
    sky: true,
  },
};

const state = {
  mode: '0',
  zoom: 1,            // 1 = the normal field of view; higher is closer in
  n: 64,
  vertexCount: 0,
  span: 64,
  buildMs: 0,
  cubes: 0,
};

const vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

// Tell WebGL how to read the three attributes out of the interleaved array.
const aPosition = gl.getAttribLocation(program, 'aPosition');
const aNormal = gl.getAttribLocation(program, 'aNormal');
const aColor = gl.getAttribLocation(program, 'aColor');

const LAYOUT = [
  [aPosition, 0],
  [aNormal, 3],
  [aColor, 6],
];

LAYOUT.forEach(([location]) => gl.enableVertexAttribArray(location));

// Level 3 uploads one buffer per sky object, so the attribute pointers must be
// re-pointed whenever we switch buffers. Every buffer uses the same layout, so
// this is the only place that knows about the stride.
function useGeometry(buffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  LAYOUT.forEach(([location, offsetInFloats]) => {
    gl.vertexAttribPointer(
      location,
      3,
      gl.FLOAT,
      false,
      STRIDE,
      offsetInFloats * BYTES_PER_FLOAT,
    );
  });
}

const uView = gl.getUniformLocation(program, 'uView');
const uProjection = gl.getUniformLocation(program, 'uProjection');
const uModel = gl.getUniformLocation(program, 'uModel');

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/* ---------------------------------------------------------------------
   8. Level 1d — the camera
   ---------------------------------------------------------------------
   The camera sweeps around a circle, always looking at the middle of the
   landscape. Its distance and height are both tied to the width of the
   terrain, so every resolution frames the same way.
   --------------------------------------------------------------------- */

const ORBIT_SPEED = .22;     // radians per second

// 33° instead of 45°: a longer lens, so the landscape fills the canvas
// instead of sitting in the middle of a wide black frame.
const BASE_FIELD_OF_VIEW = (33 * Math.PI) / 180;

function cameraFor(time) {
  const span = state.span;
  const zoom = .8;
  let camera =  {
    eye: [span * 0.97 * zoom, span * 0.69 * zoom, span * 1.17 * zoom],
    target: [0, 0, 0],
    near: Math.max(0.1, span * 0.01),
    far: span * 6 + 50,
  };

  if (state.mode === '0') {
    // The distance is scaled by tan(45°/2) / tan(33°/2) ≈ 1.4, so the cube
    // keeps exactly the apparent size it had before the longer lens.
    return { eye: [10, 5.3, 8.7], target: [0, 1, 0], near: 0.1, far: 80 };
  }

  if (MODES[state.mode].orbit) {
    // 1d — one angle that grows with time, converted into a point on a circle.
    // (The radius is a little wider than the terrain's diagonal so the corners
    // never leave the frame as the camera swings around.)
    const angle = time * ORBIT_SPEED;
    const radius = span * 1.2;
    return {
      eye: [
        Math.cos(angle) * radius,
        span * 0.45,
        Math.sin(angle) * radius,
      ],
      target: [0, 0, 0],
      near: Math.max(0.1, span * 0.01),
      far: span * 6 + 50,
    };
  }

  return camera;
}

/* ---------------------------------------------------------------------
   9. Drawing
   --------------------------------------------------------------------- */

function syncCanvasSize() {
  // Only touch width/height when it actually changed: assigning them clears
  // the canvas, and doing that every frame would wreck performance.
  if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function draw(time) {
  syncCanvasSize();

  const aspect = canvas.width / canvas.height;
  const camera = cameraFor(time, aspect);

  gl.clearColor(0.02, 0.03, 0.05, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Zoom is a narrower field of view, like a lens: the camera stays where it
  // is, so zooming can never push it inside the terrain.
  gl.uniformMatrix4fv(
    uProjection,
    false,
    perspective(BASE_FIELD_OF_VIEW / state.zoom, aspect, camera.near, camera.far),
  );
  gl.uniformMatrix4fv(uView, false, lookAt(camera.eye, camera.target, [0, 1, 0]));

  // The landscape's vertices are already in world space, so its model
  // matrix is the identity. One draw call for the entire landscape.
  gl.uniformMatrix4fv(uModel, false, IDENTITY);
  useGeometry(vertexBuffer);
  gl.drawArrays(gl.TRIANGLES, 0, state.vertexCount);

  if (MODES[state.mode].sky) drawSky(time);
}

/* ---------------------------------------------------------------------
   10. Rebuilding, the animation loop and the readout
   --------------------------------------------------------------------- */

let rafId = 0;
let modeStart = 0;
let frames = 0;
let fpsWindowStart = 0;
let fps = 0;

function updateStatus() {
  const cubeWord = state.cubes === 1 ? 'cube' : 'cubes';
  const grid = state.mode === '0' ? '2 × 2 × 2' : `${state.n} × ${state.n}`;
  const motion = MODES[state.mode].animated ? `${fps || '—'} fps` : 'static camera';

  let source = motion;
  if (MODES[state.mode].maps) {
    source = IMAGE_MAP.status === 'ready'
      ? 'maps sampled'
      : IMAGE_MAP.status === 'failed'
        ? 'maps failed to load'
        : 'loading maps…';
  }

  const zoomNote = state.zoom > 1.001 ? ` · ${state.zoom.toFixed(1)}× zoom` : '';

  statusEl.textContent =
    `${grid} · ${state.cubes.toLocaleString()} ${cubeWord} · ` +
    `${state.buildMs} ms build · ${source}${zoomNote}`;
}

function rebuild() {
  const started = performance.now();
  let built;

  if (state.mode === '0') {
    built = buildSingleCube();
  } else if (state.mode === '2') {
    // use noise landscape until the PNGs have decoded
    built = buildImageGrid(state.n) || buildGrid(state.n, MODES['1bc']);
  } else {
    built = buildGrid(state.n, MODES[state.mode]);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW);

  state.vertexCount = built.vertexCount;
  state.cubes = built.cubes;
  state.span = built.span;
  state.buildMs = Math.round(performance.now() - started);
}

function loop(now) {
  if (!modeStart) {
    modeStart = now;
    fpsWindowStart = now;
    frames = 0;
  }

  draw((now - modeStart) / 1000);

  frames++;
  if (now - fpsWindowStart >= 500) {
    fps = Math.round((frames * 1000) / (now - fpsWindowStart));
    frames = 0;
    fpsWindowStart = now;
    updateStatus();
  }

  rafId = requestAnimationFrame(loop);
}

function restartRendering() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  modeStart = 0;
  frames = 0;
  fps = 0;

  if (MODES[state.mode].animated) {
    rafId = requestAnimationFrame(loop);
  } else {
    draw(0);          // static modes draw once, not 60 times a second
  }
}

function applyMode(mode) {
  state.mode = mode;
  state.zoom = 1;   // every level opens at the same, standard 1× view

  levelButtons.forEach((button) => {
    if (button.dataset.mode === mode) {
      button.setAttribute('aria-current', 'step');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  taglineEl.textContent = MODES[mode].tagline;
  resGroup.hidden = mode === '0';   // a single cube has no grid resolution

  rebuild();
  restartRendering();
  updateStatus();
}

function markResolution(n) {
  resButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.n) === n));
  });
}

function applyResolution(n) {
  state.n = n;
  markResolution(n);
  rebuild();
  restartRendering();
  updateStatus();
}

levelButtons.forEach((button) => {
  button.addEventListener('click', () => applyMode(button.dataset.mode));
});

resButtons.forEach((button) => {
  button.addEventListener('click', () => applyResolution(Number(button.dataset.n)));
});

// Scroll to zoom in on the landscape, double-click to go back to normal.
const ZOOM_MIN = 1;
const ZOOM_MAX = 3.5;

function refreshView() {
  if (MODES[state.mode].animated) return;   // the animation loop redraws
  draw(0);
  updateStatus();
}

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0015);
  const next = Math.min(Math.max(state.zoom * factor, ZOOM_MIN), ZOOM_MAX);
  if (Math.abs(next - state.zoom) < 0.0001) return;
  state.zoom = next;
  refreshView();
}, { passive: false });

canvas.addEventListener('dblclick', () => {
  state.zoom = 1;
  refreshView();
});

window.addEventListener('resize', () => {
  if (!MODES[state.mode].animated) draw(0);
});

markResolution(state.n);
applyMode(state.mode);
