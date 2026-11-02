/* =====================================================================
   Cube landscape — Levels 0 to 3

   Where each part of the project lives in this file:
     0   buildSingleCube() 
     1a  buildGrid()      
     1b  heightField()    — scaling: the noise procedure that picks heights
     1c  paletteColor()   — colour per VERTEX, interpolated by the GPU
     1d  cameraFor()      — the Orbit toggle: the camera circling its look-at point
     2   buildImageGrid() — heights and colours read from a PNG pair
                            (also used by 3; 1b/c uses noise)
     3   drawSky()        — clouds, butterflies and soap bubbles on bezier curves

   The landscape is one interleaved buffer, drawn with a single
   gl.drawArrays call. That is what keeps 16,000+ cubes fast. Level 3 adds
   one small buffer per sky object, each drawn with its own uModel matrix.
   ===================================================================== */

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl');
const statusEl = document.getElementById('status');
const taglineEl = document.getElementById('tagline');
const levelButtons = [...document.querySelectorAll('.levels button')];
const resButtons = [...document.querySelectorAll('#res button')];
const unitGroup = document.getElementById('units');
const unitButtons = [...document.querySelectorAll('#units button')];
const orbitButton = document.getElementById('orbit');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const zoomResetButton = document.getElementById('zoom-reset');

if (!gl) {
  statusEl.textContent = 'WebGL is not available in this browser.';
  throw new Error('WebGL unavailable');
}

/* ---------------------------------------------------------------------
   1. Shaders
   --------------------------------------------------------------------- */

// The landscape's vertices arrive already in world space (translation and
// scale are baked in while the buffer is built), so its uModel only scales
// the whole terrain by LANDSCAPE_SCALE. Sky objects keep a small local
// buffer and get a real uModel.
const vertexShaderSource = `
  attribute vec3 aPosition;   // corner position, in the object's own space
  attribute vec3 aNormal;     // which way the face points
  attribute vec3 aColor;      // this corner's colour, 0..1 per channel

  uniform mat4 uModel;        // object → world. An even scale for the landscape;
                              // translation + rotation + scale for sky objects.
  uniform mat4 uView;
  uniform mat4 uProjection;

  varying vec3 vNormal;       // interpolated, then handed to the fragment shader
  varying vec3 vColor;
  varying vec3 vWorldPosition; // for the shine and the bubbles' rim

  void main() {
    // mat3(uModel) rotates the normal along with the object. Sky objects are
    // only translated, rotated and evenly scaled, so the direction stays right.
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = uProjection * uView * world;
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec3 vWorldPosition;

  uniform vec3 uCameraPosition;
  uniform float uShine;       // 0 = plain matte (Levels 0–1c), 1 = glossy city
  uniform float uBubble;      // 1 while drawing a soap bubble

  void main() {
    // A varying is blended across the triangle, so its length changes.
    // Normalising it brings it back to a unit direction.
    vec3 normal = normalize(vNormal);

    // Light from above and slightly to the side.
    vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.3));
    vec3 toCamera = normalize(uCameraPosition - vWorldPosition);
    vec3 halfway = normalize(lightDirection + toCamera);

    if (uBubble > 0.5) {
      // A soap bubble is clear in the middle and bright at its edge, where
      // you look through the most film. The film's colour shifts with that
      // angle, which is what gives bubbles their rainbow rim.
      float facing = max(dot(normal, toCamera), 0.0);
      float rim = pow(1.0 - facing, 2.0);
      vec3 film = 0.6 + 0.4 * cos(6.2832 * (rim * 1.3 + vec3(0.0, 0.33, 0.67)));
      vec3 color = mix(vec3(0.9, 0.97, 1.0), film, 0.5 * rim);
      float spec = pow(max(dot(normal, halfway), 0.0), 90.0);
      float alpha = 0.06 + 0.6 * rim + spec;
      gl_FragColor = vec4(color + spec, min(alpha, 1.0));
      return;
    }

    float brightness = max(dot(normal, lightDirection), 0.0);

    // 30% ambient so faces pointing away from the light aren't black.
    float light = 0.3 + 0.7 * brightness;

    // THE KEY LINE FOR 1c: the GPU has already blended vColor between this
    // triangle's three corners for us, so each pixel gets its own colour.
    vec3 color = vColor * light;

    // The city: a white highlight on faces turned toward the light, and the
    // blue of the sky filling in the shaded sides.
    float spec = pow(max(dot(normal, halfway), 0.0), 24.0);
    color += uShine * (0.35 * spec + 0.16 * (1.0 - brightness) * vec3(0.55, 0.8, 1.0));

    gl_FragColor = vec4(color, 1.0);
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

// Rotate around the z axis: a wind turbine's blades spin this way.
function rotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
     c, s, 0, 0,
    -s, c, 0, 0,
     0, 0, 1, 0,
     0, 0, 0, 1,
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

// The landscape is drawn this many times bigger, in every direction. Only
// the terrain is scaled: the camera and the sky objects stay where they are.
const LANDSCAPE_SCALE = 1.3;
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
    } else if (colorMode === 'image') {
      // The city levels: the top corners take the sampled image colour and
      // the base corners a deeper, bluer shade of it, so each column fades
      // up like Level 1c and a white tower reads as blue-tinted glass.
      if (py > 0) {
        data[o++] = flatColor[0];
        data[o++] = flatColor[1];
        data[o++] = flatColor[2];
      } else {
        data[o++] = flatColor[0] * 0.4 + 0.02;
        data[o++] = flatColor[1] * 0.55 + 0.1;
        data[o++] = flatColor[2] * 0.6 + 0.3;
      }
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
   512 × 512 map covers 16 × 16 pixels per cube), so each cell reads ONE
   pixel, the same way Level 1 takes one noise value per cell. Averaging
   every pixel in the cell would smooth away the fine bumps.
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

// Read one channel of the pixel under (u, v), as 0..1.
// u and v are in 0..1 image space, v measured from the BOTTOM.
function sampleChannel(image, u, v, channel) {
  const { pixels, width, height } = image;
  const x = Math.min(Math.floor(u * width), width - 1);
  const y = Math.min(Math.floor((1 - v) * height), height - 1);
  return pixels[(y * width + x) * 4 + channel] / 255;
}

const cellColor = [0, 0, 0];

function sampleColor(image, u, v, out) {
  out[0] = sampleChannel(image, u, v, 0);
  out[1] = sampleChannel(image, u, v, 1);
  out[2] = sampleChannel(image, u, v, 2);
  return out;
}

// 0 = sea level, 1 = the tallest sample. One number per grid cell.
const IMAGE_HEIGHT_GAMMA = 1.0;

// The tallest tower, as a fraction of the terrain width. Much taller than
// the noise hills (HEIGHT_RATIO): the ground only uses the bottom slice of
// the height map's brightness and the skyscrapers use the rest.
const IMAGE_HEIGHT_RATIO = 0.3;

// The city maps cover this many times the grid's width: the n × n square in
// the middle is the city, and the rest is a margin of hills and trees around
// it, so the ground runs out to the edges of the screen. The camera and the
// sky objects still use the middle square's width, so the city keeps its
// size on screen. tools/make-city-maps.mjs reads this value; run it again
// after changing it.
const CITY_EXTENT = 1;

// Levels 2 and 3: the grid, built from the two images instead of from
// noise. Returns null until the PNGs have finished decoding.
function buildImageGrid(n) {
  if (IMAGE_MAP.status !== 'ready') return null;

  const { color, height } = IMAGE_MAP;
  const across = Math.round(n * CITY_EXTENT);   // cubes per side, margin included
  const cells = across * across;
  const data = new Float32Array(cells * VERTS_PER_CUBE * FLOATS_PER_VERTEX);
  const half = (across - 1) / 2;
  const span = n * SPACING;               // the middle square, for camera and sky
  const shortest = span * 0.012;          // sea floor: low, but never zero
  const tallest = span * IMAGE_HEIGHT_RATIO;
  let offset = 0;

  for (let j = 0; j < across; j++) {
    // Image row 0 is the top of the picture. Flipping v maps it to the far
    // edge of the grid instead of mirroring the map north-to-south.
    // i / (across - 1) runs from one edge of the image to the other.
    const v = 1 - j / (across - 1);

    for (let i = 0; i < across; i++) {
      const u = i / (across - 1);

      // Height: brightness at that spot, mapped onto world heights.
      const brightness = sampleChannel(height, u, v, 0);
      const h = shortest +
        Math.pow(brightness, IMAGE_HEIGHT_GAMMA) * (tallest - shortest);

      // Colour: RGB at the same spot.
      sampleColor(color, u, v, cellColor);

      const x = (i - half) * SPACING;
      const z = (j - half) * SPACING;
      const model = multiply(translation(x, 0, z), scaling(1, h, 1));

      // 'image' colours the top from the image and fades the sides down to
      // the valley colour, the same per-vertex gradient as Level 1c.
      offset = writeCube(data, offset, model, 'image', 1, cellColor);
    }
  }

  return {
    data,
    vertexCount: cells * VERTS_PER_CUBE,
    cubes: cells,
    span,
  };
}

// Start loading immediately; an image level rebuilds itself when ready.
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
  console.warn('Image maps failed to load:', error);
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
   6c. Level 3 — a skyscape of objects on bezier curves
   ---------------------------------------------------------------------
   Clouds and butterflies are little clusters of cubes; bubbles are smooth
   spheres. Each shape is built ONCE in its own local space (a few units
   across). At draw time the GPU is handed a model matrix that scales the
   shape to the landscape, spins it and moves it along a cubic bezier curve.

   Keeping each shape in its own buffer means the landscape still costs
   one draw call, and each sky object adds only one more.
   --------------------------------------------------------------------- */

const SKY_COLORS = {
  cloud: [0.97, 0.98, 1.0],
  cloudShade: [0.8, 0.87, 0.96],
  butterflyBody: [0.12, 0.1, 0.1],
  wingEdge: [0.1, 0.1, 0.14],
  monarch: [1.0, 0.55, 0.12],
  morpho: [0.25, 0.65, 1.0],
};

// Small seeded random generator: the same seed always gives the same clouds,
// so the sky looks random but doesn't change every time the page loads.
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

// A soap bubble: a smooth unit sphere, not cubes. Every vertex's normal is
// just its position (it points straight out from the centre). The colour is
// unused, because the fragment shader shades bubbles on its own.
function buildSphere(rings, segments) {
  const point = (ring, segment) => {
    const theta = (ring / rings) * Math.PI;           // 0 at the top
    const phi = (segment / segments) * Math.PI * 2;   // around the middle
    return [
      Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      Math.sin(theta) * Math.sin(phi),
    ];
  };

  const vertexCount = rings * segments * 6;
  const data = new Float32Array(vertexCount * FLOATS_PER_VERTEX);
  let o = 0;

  const put = (p) => {
    data.set(p, o);          // position
    data.set(p, o + 3);      // normal
    data.set([1, 1, 1], o + 6);
    o += FLOATS_PER_VERTEX;
  };

  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = point(ring, segment);
      const b = point(ring + 1, segment);
      const c = point(ring + 1, segment + 1);
      const d = point(ring, segment + 1);
      // Counter-clockwise seen from outside, so back-face culling hides the
      // far half of the bubble and only its front film is drawn.
      put(a); put(c); put(b);
      put(a); put(d); put(c);
    }
  }

  return { data, vertexCount };
}

// A puffy cloud, different every time: a row of big cubes sitting on a flat,
// slightly shaded base, with a few smaller puffs piled on top. Units are
// roughly one puff wide; the cloud's origin is the middle of its flat bottom.
function makeCloudCubes(random) {
  const cubes = [];
  const puffs = 4 + Math.floor(random() * 3);    // 4 to 6 along the bottom row
  const width = puffs * 0.8;

  cubes.push({
    x: 0, y: 0, z: 0, sx: width, sy: 0.3, sz: 0.9, color: SKY_COLORS.cloudShade,
  });

  for (let k = 0; k < puffs; k++) {
    // Bigger in the middle, smaller at the ends.
    const fromMiddle = Math.abs(k - (puffs - 1) / 2) / puffs;
    cubes.push({
      x: -width / 2 + 0.4 + k * 0.8 + (random() - 0.5) * 0.3,
      y: 0.05,
      z: (random() - 0.5) * 0.4,
      size: (0.9 + random() * 0.5) * (1 - fromMiddle * 0.7),
      color: SKY_COLORS.cloud,
    });
  }

  const tops = 1 + Math.floor(random() * 3);     // 1 to 3 puffs on top
  for (let k = 0; k < tops; k++) {
    cubes.push({
      x: (random() - 0.5) * width * 0.45,
      y: 0.55 + random() * 0.25,
      z: (random() - 0.5) * 0.3,
      size: 0.6 + random() * 0.45,
      color: SKY_COLORS.cloud,
    });
  }

  return cubes;
}

// A butterfly, in three pieces so the wings can flap: the body, and each
// wing hinged on the body's long (z) axis. The head is toward +z, so turning
// the butterfly to face along its path makes it fly forwards.
const BUTTERFLY_BODY_CUBES = [
  { x: 0, y: -0.05, z: 0, sx: 0.08, sy: 0.1, sz: 0.7, color: SKY_COLORS.butterflyBody },
];

// The right wing, reaching out along +x from the hinge: a big forewing, a
// smaller hindwing and a dark tip. The left wing is the same, mirrored.
function wingCubes(color, side) {
  return [
    { x: 0.42, y: 0, z: 0.12, sx: 0.8, sy: 0.03, sz: 0.55, color },
    { x: 0.32, y: 0, z: -0.28, sx: 0.6, sy: 0.03, sz: 0.45, color },
    { x: 0.78, y: -0.004, z: 0.16, sx: 0.16, sy: 0.04, sz: 0.42, color: SKY_COLORS.wingEdge },
  ].map((cube) => ({ ...cube, x: cube.x * side }));
}

// Screen-right and into-the-screen for the default camera, on the x–z plane.
const LANE_RIGHT = [0.77, -0.64];
const LANE_BACK = [-0.64, -0.77];
const LANE_CENTRE = [0.2, 0.3];

// A path that crosses the scene from past the left edge of the screen to past
// the right edge, `lane` deep (0 runs in front of the city's centre, more is
// farther back). `heights` and `weave` give each of the four control points
// its height and a sideways swing, so the path isn't a straight line.
function lanePath(lane, heights, weave, reach) {
  const along = [-reach, -reach / 3, reach / 3, reach];

  return along.map((s, i) => {
    const back = lane + weave[i];
    return [
      LANE_CENTRE[0] + LANE_RIGHT[0] * s + LANE_BACK[0] * back,
      heights[i],
      LANE_CENTRE[1] + LANE_RIGHT[1] * s + LANE_BACK[1] * back,
    ];
  });
}

// Bubbles and butterflies stay over the island: each one loops around a
// closed path of joined cubic bezier curves through a few random spots on
// the open grass in front of and beside the city, so it never leaves the
// island's x–z footprint. Their height is how far ABOVE the ground they
// float, not a fixed height (see hoverGround).

// Is this spot (in the city map's 0..1 layout) open meadow? The front half
// of the island, plus a strip down the right-hand side; the city and the
// wind turbines are at the back. The 0.1 margin keeps the curves, which
// bulge a little past their anchor points, inside the island.
function inMeadow(u, v) {
  if (u < 0.1 || u > 0.9 || v < 0.3 || v > 0.9) return false;
  return v > 0.66 || u > 0.82;      // clear of the city and the houses around it
}

// A few random meadow spots, at least `spacing` apart, sorted by angle
// around their middle so the loop through them never crosses itself.
// Each is [x, gap above the ground, z], in fractions of the terrain width.
function meadowLoop(random, count, gap, wobble) {
  const spots = [];
  for (let attempt = 0; attempt < 500 && spots.length < count; attempt++) {
    const u = random();
    const v = random();
    if (!inMeadow(u, v)) continue;
    if (spots.some((s) => Math.hypot(s.u - u, s.v - v) < 0.18)) continue;
    spots.push({ u, v });
  }

  const cu = spots.reduce((sum, s) => sum + s.u, 0) / spots.length;
  const cv = spots.reduce((sum, s) => sum + s.v, 0) / spots.length;
  spots.sort((a, b) => Math.atan2(a.v - cv, a.u - cu) - Math.atan2(b.v - cv, b.u - cu));

  return spots.map((s) => [
    (s.u - 0.5) * LANDSCAPE_SCALE,
    gap + random() * wobble,
    (s.v - 0.5) * LANDSCAPE_SCALE,
  ]);
}

// Bubbles: radius, speed (loops per second), and how high they float, as a
// gap between the ground and the bubble's underside.
const BUBBLES = [
  { scale: 0.015, speed: 0.012, phase: 0.00, gap: 0.004 },
  { scale: 0.011, speed: 0.016, phase: 0.35, gap: 0.003 },
  { scale: 0.013, speed: 0.014, phase: 0.63, gap: 0.004 },
  { scale: 0.010, speed: 0.018, phase: 0.85, gap: 0.005 },
];

// Two butterflies fluttering low over the meadow, a little faster.
const BUTTERFLIES = [
  { color: SKY_COLORS.monarch, scale: 0.011, speed: 0.03, phase: 0.1, gap: 0.008 },
  { color: SKY_COLORS.morpho, scale: 0.01, speed: 0.026, phase: 0.6, gap: 0.01 },
];

// Clouds, spread out all around: from in front of the island, over the city,
// to far past its back edge, each at a random depth, height, size, speed and
// shape. They all drift the same way, like they're on one wind.
//
// From the opening view the camera looks down, so the top of the screen is a
// little below eye level, and the farther away a cloud is, the lower it has
// to be to show up. Each cloud's height is picked within what the camera can
// see at its distance, and any cloud crossing the island stays above the
// tallest tower.
const CLOUD_COUNT = 14;
const EYE_HEIGHT = 0.87;          // the opening camera's height, in spans
const EYE_TO_LANE_ZERO = 1.57;    // its distance in front of lane 0
const TOP_OF_VIEW = 0.14;         // tan of the angle from eye level to the top of the screen
const ISLAND_BACK_LANE = 1.3;     // lanes up to here pass over the island
const ABOVE_TOWERS = 0.45;        // the tallest tower is about 0.39 spans
const CLOUD_LOOPS_PER_SECOND = 0.0042;

const CLOUDS = (() => {
  const random = makeRandom(20261103);

  // Where each cloud starts along its loop: one evenly spaced slot each,
  // shuffled so near and far clouds mix on both sides of the screen.
  const across = Array.from({ length: CLOUD_COUNT }, (_, k) => (k + 0.5) / CLOUD_COUNT);
  for (let k = across.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [across[k], across[j]] = [across[j], across[k]];
  }

  return Array.from({ length: CLOUD_COUNT }, (_, k) => {
    // Depths spread evenly (one per slot, jittered) from in front of the
    // island to past its back edge, so no side gets them all.
    const lane = -0.3 + ((k + random()) / CLOUD_COUNT) * 2.9;
    const distance = EYE_TO_LANE_ZERO + lane;
    const highest = EYE_HEIGHT - TOP_OF_VIEW * distance;
    const lowest = lane < ISLAND_BACK_LANE ? ABOVE_TOWERS : 0.04;
    const y = lowest + random() * Math.max(highest - lowest, 0);

    // Farther clouds are bigger, so they still read from a distance. Each
    // path reaches just past the screen's edge at its distance (even on a
    // very wide window), so a cloud that drifts off one side soon comes
    // back on the other instead of leaving that side empty for a minute.
    const reach = 0.75 * distance + 0.35;

    // Start each cloud at its own evenly spaced slot around its loop. With
    // every loop taking about the same time, that even spacing holds as they
    // drift: most are on screen at any moment, spread across it, and as one
    // drifts off one side another comes in on the other.
    const phase = across[k];

    return {
      cubes: makeCloudCubes(random),
      lane,
      heights: [y, y + 0.02 * (random() - 0.5), y + 0.02 * (random() - 0.5), y],
      reach,
      scale: (0.045 + random() * 0.03) * (1 + Math.max(lane - 1, 0) * 0.35),
      // Nearly the same loop time for every cloud (about 4 minutes), so the
      // even spread they start with holds as they drift instead of bunching.
      speed: CLOUD_LOOPS_PER_SECOND * (0.95 + random() * 0.1),
      phase,
    };
  });
})();

// Coordinates = fractions of the landscape width for grid resolution independence
const SKY_DEFINITIONS = [
  ...BUBBLES.map((bubble, index) => ({
    name: `bubble ${index + 1}`,
    bubble: true,
    loop: meadowLoop(makeRandom(4100 + index), 5, bubble.gap, 0.006),
    scale: bubble.scale,
    speed: bubble.speed,
    phase: bubble.phase,
    spin: 0,
    hover: true,
    bob: 0.005,                 // a gentle up-and-down wobble on top of the path
    bobSpeed: 1.4,
    hideAfter: 1,
  })),
  ...CLOUDS.map((cloud, index) => ({
    name: `cloud ${index + 1}`,
    cubes: cloud.cubes,
    path: lanePath(cloud.lane, cloud.heights, [0, 0.08, -0.08, 0], cloud.reach),
    scale: cloud.scale,
    speed: cloud.speed,
    phase: cloud.phase,
    spin: 0,
    hideAfter: 1,
  })),
  ...BUTTERFLIES.map((butterfly, index) => ({
    name: `butterfly ${index + 1}`,
    butterfly: true,
    color: butterfly.color,
    loop: meadowLoop(makeRandom(5200 + index), 6, butterfly.gap, 0.015),
    scale: butterfly.scale,
    speed: butterfly.speed,
    phase: butterfly.phase,
    spin: 0,
    hover: true,
    bob: 0.008,                 // a quick, uneven flutter up and down
    bobSpeed: 2.6,
    hideAfter: 1,
  })),
];

// Where the ground is under each hovering object, all along its path, so it
// can float a set gap above it. Recomputed by hoverGround() whenever the
// landscape is rebuilt (the grid size changes the world's scale).
// The highest cube top under a circle of radius `r` at (x, z), in world
// units. Each cube's height is read exactly the way buildImageGrid() reads
// it, from the one image pixel at its cell, so none can be missed.
function groundUnder(x, z, r, span) {
  if (IMAGE_MAP.status !== 'ready') return 0;
  const n = Math.round(span / SPACING);
  const across = Math.round(n * CITY_EXTENT);
  const half = (across - 1) / 2;
  const cell = SPACING * LANDSCAPE_SCALE;
  const shortest = span * 0.012;
  const tallest = span * IMAGE_HEIGHT_RATIO;

  let highest = 0;
  const i0 = Math.max(0, Math.floor((x - r) / cell + half));
  const i1 = Math.min(across - 1, Math.ceil((x + r) / cell + half));
  const j0 = Math.max(0, Math.floor((z - r) / cell + half));
  const j1 = Math.min(across - 1, Math.ceil((z + r) / cell + half));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      // Skip cubes whose square the circle doesn't reach.
      const dx = Math.max(Math.abs(x - (i - half) * cell) - cell / 2, 0);
      const dz = Math.max(Math.abs(z - (j - half) * cell) - cell / 2, 0);
      if (Math.hypot(dx, dz) > r) continue;
      const brightness = sampleChannel(IMAGE_MAP.height, i / (across - 1), 1 - j / (across - 1), 0);
      highest = Math.max(highest, (shortest + brightness * (tallest - shortest)) * LANDSCAPE_SCALE);
    }
  }
  return highest;
}

const HOVER_SAMPLES = 400;

function hoverGround(span) {
  for (const object of SKY_OBJECTS) {
    if (!object.hover) continue;

    // The highest ground under the object's whole footprint at each step...
    const radius = span * object.scale;
    const raw = new Float32Array(HOVER_SAMPLES + 1);
    for (let k = 0; k <= HOVER_SAMPLES; k++) {
      const p = pathPoint(object, k / HOVER_SAMPLES);
      raw[k] = groundUnder(p[0] * span, p[2] * span, radius, span);
    }

    // The samples just around step k. On a closed loop they wrap around,
    // since the end of the loop is its start.
    const window = 3;
    const around = (k) => {
      const steps = [];
      for (let j = k - window; j <= k + window; j++) {
        if (object.loop) steps.push(((j % HOVER_SAMPLES) + HOVER_SAMPLES) % HOVER_SAMPLES);
        else if (j >= 0 && j <= HOVER_SAMPLES) steps.push(j);
      }
      return steps;
    };

    // ...then the highest point over a short stretch either side, so the
    // object starts rising just before it reaches a bump instead of hopping
    // up each cube, and finally an average to round off the corners.
    const peaks = raw.map((_, k) => Math.max(...around(k).map((j) => raw[j])));
    object.ground = peaks.map((_, k) => {
      let sum = 0;
      let count = 0;
      for (const j of around(k)) {
        sum += peaks[j];
        count++;
      }
      // Never below the bumps themselves, even after averaging.
      return Math.max(sum / count, raw[k]);
    });
  }
}

// Cubic bezier: a curve from p0 to p3, pulled toward p1 and p2.
//   B(t) = (1-t)³·p0 + 3(1-t)²t·p1 + 3(1-t)t²·p2 + t³·p3
// The four weights always sum to 1, so the result is a weighted average of
// the control points: t = 0 sits on p0, t = 1 sits on p3.
// A closed loop through `anchors`, one cubic bezier per pair of neighbours.
// Each curve's two inner control points are set from the anchors on either
// side (the Catmull-Rom rule), so every join is smooth: the curve leaving an
// anchor heads in the same direction as the one arriving. t runs 0..1 once
// around the whole loop.
function loopPoint(anchors, t) {
  const n = anchors.length;
  const s = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(s);
  const at = (k) => anchors[((k % n) + n) % n];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  const c1 = p1.map((v, axis) => v + (p2[axis] - p0[axis]) / 6);
  const c2 = p2.map((v, axis) => v - (p3[axis] - p1[axis]) / 6);
  return bezierPoint([p1, c1, c2, p2], s - i);
}

// Where an object is along its path: an open curve, or a closed loop.
function pathPoint(object, t) {
  return object.loop ? loopPoint(object.loop, t) : bezierPoint(object.path, t);
}

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
  // Every bubble shares one sphere buffer; only its model matrix differs.
  const sphere = buildSphere(16, 24);
  const sphereBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.data, gl.STATIC_DRAW);

  const upload = (cubes) => {
    const built = buildCluster(cubes);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW);
    return { buffer, vertexCount: built.vertexCount };
  };

  // Butterflies share one body; each colour gets its own pair of wings.
  const butterflyBody = upload(BUTTERFLY_BODY_CUBES);

  return SKY_DEFINITIONS.map((definition) => {
    if (definition.bubble) {
      return { ...definition, buffer: sphereBuffer, vertexCount: sphere.vertexCount };
    }
    if (definition.butterfly) {
      return {
        ...definition,
        ...butterflyBody,
        rightWing: upload(wingCubes(definition.color, 1)),
        leftWing: upload(wingCubes(definition.color, -1)),
      };
    }
    return { ...definition, ...upload(definition.cubes) };
  });
}

const SKY_OBJECTS = createSkyObjects();

const BUTTERFLY_FLAP_SPEED = 9;   // radians per second: a few beats a second

// Where one sky object is right now, in world units, plus its model matrix.
function placeSkyObject(object, time, span) {
  const t = (time * object.speed + object.phase) % 1;
  if (t > object.hideAfter) return null;   // safety hatch; paths end off-screen

  const p = pathPoint(object, t);
  let bob = 0;
  if (object.bob) {
    const phase = time * object.bobSpeed + object.phase * 20;
    bob = Math.sin(phase) * object.bob;
    // Butterflies add a faster, smaller wobble, so they flit unevenly.
    if (object.butterfly) bob += Math.sin(phase * 2.8) * object.bob * 0.35;
  }
  const size = span * object.scale;

  let y = (p[1] + bob) * span;
  if (object.hover) {
    // Hovering objects only bob upward, so the gap never closes, and float
    // that gap above the ground under them (plus their own radius, for a
    // bubble, whose origin is its centre).
    const ground = object.ground
      ? object.ground[Math.round(t * HOVER_SAMPLES)]
      : 0;
    const lift = object.bubble ? size : 0;
    y = ground + lift + (p[1] + Math.abs(bob)) * span;
  }
  const position = [p[0] * span, y, p[2] * span];

  // A butterfly turns to face where it's going: the direction from here to a
  // point a little farther along its path. Everything else spins slowly.
  let turn = time * object.spin + object.phase * Math.PI * 2;
  if (object.butterfly) {
    const ahead = pathPoint(object, object.loop ? t + 0.005 : Math.min(t + 0.005, 1));
    turn = Math.atan2(ahead[0] - p[0], ahead[2] - p[2]);
  }

  // Scale the little cluster up, turn it, then move it onto the curve.
  // multiply(a, b) runs b first, so this reads right-to-left: S → R → T.
  const model = multiply(
    translation(position[0], position[1], position[2]),
    multiply(rotationY(turn), scaling(size, size, size)),
  );

  // Wings swing from a little below flat to well up, around the body's axis.
  const flap = 0.35 + 0.65 * Math.sin(time * BUTTERFLY_FLAP_SPEED + object.phase * 7);

  return { object, position, model, flap };
}

function drawPart(model, part) {
  gl.uniformMatrix4fv(uModel, false, model);
  useGeometry(part.buffer);
  gl.drawArrays(gl.TRIANGLES, 0, part.vertexCount);
}

function drawSkyObject({ object, model, flap }) {
  drawPart(model, object);
  if (object.butterfly) {
    // rotationZ lifts +x up for a positive angle and −x up for a negative
    // one, so the two wings rise and fall together.
    drawPart(multiply(model, rotationZ(flap)), object.rightWing);
    drawPart(multiply(model, rotationZ(-flap)), object.leftWing);
  }
}

function drawSky(time, eye) {
  const span = state.span;
  const placed = SKY_OBJECTS
    .map((object) => placeSkyObject(object, time, span))
    .filter(Boolean);

  // Solid objects (clouds, butterflies) first, like the landscape.
  placed.filter((item) => !item.object.bubble).forEach(drawSkyObject);

  // Then the bubbles, which are see-through. Blending mixes each bubble with
  // whatever is already drawn behind it, so they go last, farthest first.
  // They don't write depth, so one bubble never cuts a hole in another.
  // The separate alpha factors keep the canvas's own alpha correct where a
  // bubble sits over the transparent sky.
  const distance = (item) => Math.hypot(
    item.position[0] - eye[0],
    item.position[1] - eye[1],
    item.position[2] - eye[2],
  );
  const bubbles = placed
    .filter((item) => item.object.bubble)
    .sort((a, b) => distance(b) - distance(a));

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.enable(gl.CULL_FACE);
  gl.uniform1f(uBubble, 1);

  bubbles.forEach(drawSkyObject);

  gl.uniform1f(uBubble, 0);
  gl.disable(gl.CULL_FACE);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

/* ---------------------------------------------------------------------
   6d. Wind turbines on the city levels
   ---------------------------------------------------------------------
   Each turbine is two pieces, both built from cubes: the still body
   (tower, nacelle, hub) and one blade, drawn three times at 120° apart.
   Their model matrices stand the turbine on the ground at its spot, turn
   it to face the default camera, and spin the blades around the hub.
   Lengths below are fractions of the tower's height.
   --------------------------------------------------------------------- */

const TURBINE_WHITE = [0.96, 0.98, 1.0];
const TURBINE_GREY = [0.84, 0.9, 0.95];

const TURBINE_BODY_CUBES = [
  { x: 0, y: -0.05, z: 0, sx: 0.06, sy: 0.45, sz: 0.06, color: TURBINE_WHITE },   // wider foot
  { x: 0, y: 0, z: 0, sx: 0.04, sy: 1, sz: 0.04, color: TURBINE_WHITE },          // tower
  { x: 0, y: 0.97, z: 0, sx: 0.07, sy: 0.07, sz: 0.2, color: TURBINE_GREY },      // nacelle
  { x: 0, y: 0.975, z: 0.12, sx: 0.06, sy: 0.06, sz: 0.05, color: TURBINE_WHITE }, // hub
];

// One blade, pointing straight up from the hub and narrowing toward its tip.
const TURBINE_BLADE_CUBES = [
  { x: 0, y: 0, z: 0, sx: 0.05, sy: 0.12, sz: 0.012, color: TURBINE_WHITE },
  { x: 0, y: 0.12, z: 0, sx: 0.038, sy: 0.25, sz: 0.01, color: TURBINE_WHITE },
  { x: 0, y: 0.37, z: 0, sx: 0.024, sy: 0.17, sz: 0.008, color: TURBINE_WHITE },
];

const TURBINE_HUB = [0, 1.005, 0.15];   // where the blades turn, in front of the hub
const TURBINE_HEIGHT = 0.15;            // tower height, as a fraction of the terrain width
const TURBINE_FACING = 0.69;            // radians: rotor turned toward the default camera
const TURBINE_SPIN = 0.45;              // radians per second: a slow, lazy turn

// Spots in the city map's layout (0..1 across the island, as in
// tools/make-city-maps.mjs): a row along the far edge, right of the city,
// clear of the roads and the bubbles' lanes across the front.
const TURBINES = [
  { u: 0.79, v: 0.06, offset: 0.0 },
  { u: 0.96, v: 0.05, offset: 0.7 },
];

function uploadCluster(cubes) {
  const built = buildCluster(cubes);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW);
  return { buffer, vertexCount: built.vertexCount };
}

const TURBINE_BODY = uploadCluster(TURBINE_BODY_CUBES);
const TURBINE_BLADE = uploadCluster(TURBINE_BLADE_CUBES);

// Where a turbine stands, in world units: the layout spot scaled like the
// landscape, on top of the tallest ground right around it.
function turbineBase(turbine) {
  const span = state.span;
  const low = 0.5 - CITY_EXTENT / 2;
  const shortest = span * 0.012;
  const tallest = span * IMAGE_HEIGHT_RATIO;

  let brightness = 0;
  for (const du of [-0.012, 0, 0.012]) {
    for (const dv of [-0.012, 0, 0.012]) {
      const u = (turbine.u + du - low) / CITY_EXTENT;
      const v = 1 - (turbine.v + dv - low) / CITY_EXTENT;
      brightness = Math.max(brightness, sampleChannel(IMAGE_MAP.height, u, v, 0));
    }
  }

  return [
    (turbine.u - 0.5) * span * LANDSCAPE_SCALE,
    (shortest + brightness * (tallest - shortest)) * LANDSCAPE_SCALE,
    (turbine.v - 0.5) * span * LANDSCAPE_SCALE,
  ];
}

function drawTurbines(time) {
  const size = state.span * TURBINE_HEIGHT;

  for (const turbine of TURBINES) {
    const [x, y, z] = turbineBase(turbine);
    const base = multiply(
      translation(x, y, z),
      multiply(rotationY(TURBINE_FACING), scaling(size, size, size)),
    );

    gl.uniformMatrix4fv(uModel, false, base);
    useGeometry(TURBINE_BODY.buffer);
    gl.drawArrays(gl.TRIANGLES, 0, TURBINE_BODY.vertexCount);

    useGeometry(TURBINE_BLADE.buffer);
    for (let blade = 0; blade < 3; blade++) {
      const angle = time * TURBINE_SPIN + turbine.offset + (blade * Math.PI * 2) / 3;
      const model = multiply(
        base,
        multiply(translation(...TURBINE_HUB), rotationZ(angle)),
      );
      gl.uniformMatrix4fv(uModel, false, model);
      gl.drawArrays(gl.TRIANGLES, 0, TURBINE_BLADE.vertexCount);
    }
  }
}

/* ---------------------------------------------------------------------
   7. Scene state
   --------------------------------------------------------------------- */

const MODES = {
  // Levels 0 and 1a share the Units tab; the Cube / Grid toggle picks one.
  '0': {
    tagline: '',
    heights: false,
    colors: 'flat',
  },
  '1a': {
    tagline: '',
    heights: false,
    colors: 'flat',
  },
  '1bc': {
    tagline: '',
    heights: true,
    colors: 'height',
  },
  '2': {
    tagline: '',
    heights: true,
    colors: 'image',
    maps: true,
  },
  '3': {
    tagline: '',
    animated: true,     // the sky objects move even with the camera still
    heights: true,
    colors: 'image',
    maps: true,
    sky: true,
  },
};

const UNIT_MODES = ['0', '1a'];

const state = {
  mode: '3',
  unit: '0',          // which of the Units tab's two levels was last shown
  orbit: false,       // Level 1d: the camera circles the scene, on any tab
  noise: false,       // the terrain on screen was built from fBm noise
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
const uCameraPosition = gl.getUniformLocation(program, 'uCameraPosition');
const uShine = gl.getUniformLocation(program, 'uShine');
const uBubble = gl.getUniformLocation(program, 'uBubble');

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/* ---------------------------------------------------------------------
   8. Level 1d — the camera
   ---------------------------------------------------------------------
   Each tab has a still camera aimed at the middle of its scene; its
   distance and height are tied to the width of the terrain, so every
   resolution frames the same way. The Orbit toggle (Level 1d) sweeps that
   camera around a circle, still looking at the middle.
   --------------------------------------------------------------------- */

const ORBIT_SPEED = .22;     // radians per second

// 33° instead of 45°: a longer lens, so the landscape fills the canvas
// instead of sitting in the middle of a wide black frame.
const BASE_FIELD_OF_VIEW = (33 * Math.PI) / 180;

function cameraFor(time) {
  const span = state.span;
  // 1.27 puts the terrain's near corner right at the bottom edge of the
  // screen at 1× zoom, so zooming out shows the whole island.
  const zoom = 1.27;
  let camera =  {
    eye: [span * 0.97 * zoom, span * 0.69 * zoom, span * 1.17 * zoom],
    target: [0, 0, 0],
    near: Math.max(0.1, span * 0.01),
    far: span * 6 + 50,
  };

  if (state.mode === '0') {
    // The distance is scaled by tan(45°/2) / tan(33°/2) ≈ 1.4, so the cube
    // keeps exactly the apparent size it had before the longer lens.
    camera = { eye: [10, 5.3, 8.7], target: [0, 1, 0], near: 0.1, far: 80 };
  }

  if (state.orbit) {
    // 1d — swing the still camera around the point it looks at: one angle
    // that grows with time turns the eye around a circle at the same height
    // and distance, so every tab orbits from exactly its usual view. On the
    // landscape, whenever the camera lines up with a corner, that corner
    // just touches the bottom of the screen.
    const angle = time * ORBIT_SPEED;
    const [x, y, z] = camera.eye;
    const [tx, , tz] = camera.target;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    camera.eye = [
      tx + (x - tx) * c - (z - tz) * s,
      y,
      tz + (x - tx) * s + (z - tz) * c,
    ];
  }

  return camera;
}

// Anything that changes over time needs the animation loop: the sky, or
// the orbiting camera.
function isAnimated() {
  return Boolean(MODES[state.mode].animated) || state.orbit;
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

  // The city levels clear to transparent, so the CSS sky behind the canvas
  // shows through; the other levels keep the dark background.
  const city = Boolean(MODES[state.mode].maps);
  if (city) {
    gl.clearColor(0, 0, 0, 0);
  } else {
    gl.clearColor(0.02, 0.03, 0.05, 1);
  }
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.uniform3fv(uCameraPosition, camera.eye);
  gl.uniform1f(uShine, city ? 1 : 0);
  gl.uniform1f(uBubble, 0);

  // Zoom is a narrower field of view, like a lens: the camera stays where it
  // is, so zooming can never push it inside the terrain.
  gl.uniformMatrix4fv(
    uProjection,
    false,
    perspective(BASE_FIELD_OF_VIEW / state.zoom, aspect, camera.near, camera.far),
  );
  gl.uniformMatrix4fv(uView, false, lookAt(camera.eye, camera.target, [0, 1, 0]));

  // The landscape's vertices are already in world space; its model matrix
  // only scales it up by LANDSCAPE_SCALE around the centre (Level 0's cube
  // stays as it is). The sky objects get their own model matrices, so they
  // keep their size and paths. One draw call for the entire landscape.
  const landscapeModel = state.mode === '0'
    ? IDENTITY
    : scaling(LANDSCAPE_SCALE, LANDSCAPE_SCALE, LANDSCAPE_SCALE);
  gl.uniformMatrix4fv(uModel, false, landscapeModel);
  useGeometry(vertexBuffer);
  gl.drawArrays(gl.TRIANGLES, 0, state.vertexCount);

  // The turbines stand on the image's ground, so they wait for the maps.
  if (city && IMAGE_MAP.status === 'ready') drawTurbines(time);

  if (MODES[state.mode].sky) drawSky(time, camera.eye);
}

/* ---------------------------------------------------------------------
   10. Rebuilding, the animation loop and the readout
   --------------------------------------------------------------------- */

let rafId = 0;
let modeStart = 0;
let frames = 0;
let fpsWindowStart = 0;
let fps = 0;

// "fractional Brownian noise" in the status line links to a definition.
const FBM_LINK = (() => {
  const link = document.createElement('a');
  link.href = 'https://en.wikipedia.org/wiki/Fractional_Brownian_motion';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'fractional Brownian noise';
  link.title = 'What fractional Brownian motion is (Wikipedia, opens in a new tab)';
  return link;
})();

function updateStatus() {
  // Only the parts that apply, joined with dots, so nothing leaves a dot
  // hanging on its own (a still camera has no fps, an image level no noise).
  const parts = [
    `${state.buildMs} ms to build`,
    state.noise ? FBM_LINK : '',
    isAnimated() ? `${fps || '—'} fps` : '',
  ].filter(Boolean);

  statusEl.replaceChildren(...parts.flatMap((part, i) => (i === 0 ? [part] : [' · ', part])));
}

function rebuild() {
  const started = performance.now();
  let built;

  // Whether the heights on screen come from the fBm noise (heightField),
  // for the status line.
  state.noise = false;

  if (state.mode === '0') {
    built = buildSingleCube();
  } else if (MODES[state.mode].maps) {
    // use the noise landscape until the PNGs have decoded
    built = buildImageGrid(state.n);
    if (!built) {
      built = buildGrid(state.n, MODES['1bc']);
      state.noise = true;
    }
  } else {
    built = buildGrid(state.n, MODES[state.mode]);
    state.noise = Boolean(MODES[state.mode].heights);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW);

  state.vertexCount = built.vertexCount;
  state.cubes = built.cubes;
  state.span = built.span;
  if (MODES[state.mode].sky) hoverGround(state.span);
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

  if (isAnimated()) {
    rafId = requestAnimationFrame(loop);
  } else {
    draw(0);          // static modes draw once, not 60 times a second
  }
}

function applyMode(mode) {
  state.mode = mode;   // state.zoom and state.orbit are left alone, so they carry over
  const unitTab = UNIT_MODES.includes(mode);
  if (unitTab) state.unit = mode;

  levelButtons.forEach((button) => {
    const tab = button.dataset.mode;
    if (tab === mode || (tab === 'units' && unitTab)) {
      button.setAttribute('aria-current', 'step');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  unitGroup.hidden = !unitTab;
  unitButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.unit === mode));
  });

  taglineEl.textContent = MODES[mode].tagline;
  // A single cube has no grid resolution: the bar stays put but greys out.
  resButtons.forEach((button) => {
    button.disabled = mode === '0';
  });

  rebuild();
  restartRendering();
  updateStatus();
}

function applyOrbit(on) {
  state.orbit = on;
  orbitButton.setAttribute('aria-pressed', String(on));
  restartRendering();   // starts (or stops) the loop, from the usual view
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
  // The Units tab reopens whichever of its two levels was shown last.
  const mode = () => (button.dataset.mode === 'units' ? state.unit : button.dataset.mode);
  button.addEventListener('click', () => applyMode(mode()));
});

unitButtons.forEach((button) => {
  button.addEventListener('click', () => applyMode(button.dataset.unit));
});

orbitButton.addEventListener('click', () => applyOrbit(!state.orbit));

resButtons.forEach((button) => {
  button.addEventListener('click', () => applyResolution(Number(button.dataset.n)));
});

// Zoom: the +/− buttons or scrolling, double-click or the middle button to
// go back to 1×. Below 1× the lens widens, so the landscape looks smaller.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.5;
const ZOOM_STEP = 1.25;    // each button press zooms by 25%

function refreshView() {
  zoomResetButton.textContent = `${state.zoom.toFixed(1)}×`;
  zoomOutButton.disabled = state.zoom <= ZOOM_MIN + 0.0001;
  zoomInButton.disabled = state.zoom >= ZOOM_MAX - 0.0001;
  updateStatus();
  if (isAnimated()) return;   // the animation loop redraws
  draw(0);
}

function setZoom(zoom) {
  const next = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
  if (Math.abs(next - state.zoom) < 0.0001) return;
  state.zoom = next;
  refreshView();
}

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  setZoom(state.zoom * Math.exp(-event.deltaY * 0.0015));
}, { passive: false });

canvas.addEventListener('dblclick', () => setZoom(1));
zoomInButton.addEventListener('click', () => setZoom(state.zoom * ZOOM_STEP));
zoomOutButton.addEventListener('click', () => setZoom(state.zoom / ZOOM_STEP));
zoomResetButton.addEventListener('click', () => setZoom(1));

window.addEventListener('resize', () => {
  if (!isAnimated()) draw(0);
});

markResolution(state.n);
applyMode(state.mode);
