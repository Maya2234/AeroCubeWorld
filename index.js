/* =====================================================================
   Cube landscape — Levels 0 and 1

   Where each part of Level 1 lives in this file:
     1a  buildGrid()     — translation: every cube's spot on the x–z plane
     1b  heightField()   — scaling: the procedure that picks each height
     1c  paletteColor()  — colour per VERTEX, interpolated by the GPU
     1d  cameraFor()     — the camera orbiting its look-at point

   The whole landscape is one interleaved buffer, drawn with a single
   gl.drawArrays call. That is what keeps 16,000+ cubes fast.
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

// Positions arrive already in world space, so there is no uModel uniform
// any more: the translation and scale are applied once, on the CPU, while
// the buffer is built. (See buildGrid.)
const vertexShaderSource = `
  attribute vec3 aPosition;   // corner position, already placed in the world
  attribute vec3 aNormal;     // which way the face points
  attribute vec3 aColor;      // this corner's colour, 0..1 per channel

  uniform mat4 uView;
  uniform mat4 uProjection;

  varying vec3 vNormal;       // interpolated, then handed to the fragment shader
  varying vec3 vColor;

  void main() {
    vNormal = aNormal;
    vColor = aColor;
    gl_Position = uProjection * uView * vec4(aPosition, 1.0);
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
   2. The unit cube — the only geometry the GPU ever sees
   ---------------------------------------------------------------------
   36 vertices: 12 triangles, 6 per face. Each vertex is 6 floats:
   position (x, y, z) then normal (nx, ny, nz). The cube is 1×1×1 and its
   base sits on y = 0, so scaling y makes it grow upward from the ground.
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
   3. Matrix helpers
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
   4. Level 1b — the height procedure
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
const HILLS = 2.6;              // how many big hills across the terrain
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

const FLAT_COLOR = [0.40, 0.55, 0.80];   // used by Level 1a (no colour rule yet)
const SINGLE_COLOR = [0.86, 0.47, 0.30];

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
        FLAT_COLOR,
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

// Level 0: one cube measuring 2 × 2 × 2, centred on the origin.
function buildSingleCube() {
  const data = new Float32Array(VERTS_PER_CUBE * FLOATS_PER_VERTEX);
  const model = multiply(translation(0, 0, 0), scaling(2, 2, 2));
  writeCube(data, 0, model, 'flat', 1, SINGLE_COLOR);
  return { data, vertexCount: VERTS_PER_CUBE, cubes: 1, span: 2 };
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
    heights: true,
    colors: 'height',
  },
};

const state = {
  mode: '1d',
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

[
  [aPosition, 0],
  [aNormal, 3],
  [aColor, 6],
].forEach(([location, offsetInFloats]) => {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    3,
    gl.FLOAT,
    false,
    STRIDE,
    offsetInFloats * BYTES_PER_FLOAT,
  );
});

const uView = gl.getUniformLocation(program, 'uView');
const uProjection = gl.getUniformLocation(program, 'uProjection');

/* ---------------------------------------------------------------------
   8. Level 1d — the camera
   ---------------------------------------------------------------------
   The camera sweeps around a circle, always looking at the middle of the
   landscape. Its distance and height are both tied to the width of the
   terrain, so every resolution frames the same way.
   --------------------------------------------------------------------- */

const ORBIT_SPEED = 0.22;     // radians per second

function cameraFor(time, aspect) {
  // A narrow window sees less left-to-right, so pull the camera back.
  const fit = Math.max(1, 1.35 / aspect);

  if (state.mode === '0') {
    return { eye: [5.0, 3.8, 6.2], target: [0, 1, 0], near: 0.1, far: 80 };
  }

  const span = state.span;

  if (MODES[state.mode].orbit) {
    // 1d — one angle that grows with time, converted into a point on a circle.
    // (The radius is a little wider than the terrain's diagonal so the corners
    // never leave the frame as the camera swings around.)
    const angle = time * ORBIT_SPEED;
    const radius = span * 1.4 * fit;
    return {
      eye: [
        Math.cos(angle) * radius,
        span * 0.62 * fit,
        Math.sin(angle) * radius,
      ],
      target: [0, 0, 0],                                  // look at the centre
      near: Math.max(0.1, span * 0.01),
      far: span * 6 + 50,
    };
  }

  return {
    eye: [span * 0.92 * fit, span * 0.72 * fit, span * 1.12 * fit],
    target: [0, 0, 0],
    near: Math.max(0.1, span * 0.01),
    far: span * 6 + 50,
  };
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

  gl.uniformMatrix4fv(
    uProjection,
    false,
    perspective(Math.PI / 4, aspect, camera.near, camera.far),
  );
  gl.uniformMatrix4fv(uView, false, lookAt(camera.eye, camera.target, [0, 1, 0]));

  // One draw call for the entire landscape.
  gl.drawArrays(gl.TRIANGLES, 0, state.vertexCount);
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
  const motion = MODES[state.mode].orbit ? `${fps || '—'} fps` : 'static camera';
  statusEl.textContent =
    `${grid} · ${state.cubes.toLocaleString()} ${cubeWord} · ` +
    `${state.buildMs} ms build · ${motion}`;
}

function rebuild() {
  const started = performance.now();
  const built =
    state.mode === '0'
      ? buildSingleCube()
      : buildGrid(state.n, MODES[state.mode]);

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

  if (MODES[state.mode].orbit) {
    rafId = requestAnimationFrame(loop);
  } else {
    draw(0);          // static modes draw once, not 60 times a second
  }
}

function applyMode(mode) {
  state.mode = mode;

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

window.addEventListener('resize', () => {
  if (!MODES[state.mode].orbit) draw(0);
});

markResolution(state.n);
applyMode(state.mode);
