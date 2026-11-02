# Level 1 — Procedural cube landscape: how it works, and how to rebuild it

This is the companion document to [index.js](index.js). It explains every decision in the
Level 1 implementation and gives you an order of operations for writing it yourself from a
blank file. Nothing here is magic: it is one cube mesh, a loop, four matrix helpers and a
noise function.

The app has four tabs because Level 1 has four separate ideas:

| Tab | Shows | Level part |
| --- | --- | --- |
| `1a` | a grid of identical unit cubes on the x–z plane | translation |
| `1b/c` | the same grid, each cube stretched in y and coloured per corner | scaling + colour |
| `1d` | the finished landscape with the camera circling it | camera path |
| `0` | the single 2×2×2 cube from Project 0 | previous level |

The grid buttons (`16² … 128²`) rebuild the same landscape at a different number of cubes.
The readout next to them names the current resolution, the cube count, how long the rebuild
took, and either the frame rate (animated tab) or `static camera` (still tabs).

---

## 0. The idea that makes the whole level cheap

You could draw 4,096 cubes by calling `gl.drawArrays` 4,096 times, changing a "model
matrix" uniform between calls. It is the obvious approach and it works — up to a few
thousand cubes, where the per-draw-call CPU overhead starts to dominate. At 128 × 128 that
is 16,384 draw calls per frame, and the browser will not keep up.

The version in [index.js](index.js) does the opposite: **it bakes every cube's final position and colour into one big array once, uploads it as a single buffer, and draws the entire landscape with one call.**

```
CPU, once per rebuild                 GPU, every frame
┌───────────────────────────┐         ┌────────────────────────────┐
│ for each grid cell:       │         │ gl.drawArrays(             │
│   translate + scale cube  │  ────►  │   gl.TRIANGLES, 0,         │
│   colour each corner      │ buffer  │   36 × cubeCount)          │
│   append 36 vertices      │         └────────────────────────────┘
└───────────────────────────┘
```

This is the same trade-off as "instancing" (drawing one mesh many times) but done by hand
and without extensions. The price is memory: 36 vertices × 9 floats × 4 bytes = 1,296 bytes
per cube, so 128² costs about 21 MB. That is comfortably fine.

**What this means for the level:** translation and scaling are still real 3D transforms, but
they are applied on the CPU with the same 4×4 matrices you would upload as a uniform. Level 0
used a `uModel` uniform; Level 1 sends already-transformed world-space positions, so the
vertex shader has no model matrix at all.

---

## 1. Keep the unit cube from Level 0

Everything starts from one mesh: a 1×1×1 cube with **its base on y = 0**.

```
        y
        │   ┌─────┐  y = 1  (top)
        │  ╱     ╱│
        │ ┌─────┐ │
        │ │     │ │
        │ └─────┘─┘  y = 0  (base)
        └──────────── x, z ∈ [-0.5, 0.5]
```

Two details matter later:

1. **The base sits at y = 0.** Scaling y then stretches the cube *upward* from the ground,
   which is exactly what a terrain needs. A cube centred on the origin would grow in both
   directions and sink below the plane.
2. **The mesh is built from 36 vertices, not 8.** Six faces × two triangles × three
   vertices. Vertices are duplicated at the corners because each face needs its own normal
   for lighting, and because each corner needs its own colour later.

The cube is stored as 6 floats per vertex (position xyz + normal xyz). The big buffer adds a
7th–9th float: the colour. So the interleaved layout is `px py pz nx ny nz r g b`, stride
36 bytes.

---

## 2. The four matrix helpers

You only need `translation`, `scaling`, `multiply`, `perspective` and `lookAt`. All matrices
are column-major `Float32Array`-friendly arrays of 16 numbers, which is what
`gl.uniformMatrix4fv` expects with `transpose = false`.

### Translation

```
T(x,y,z) =  1 0 0 x        column-major array:
            0 1 0 y        [1,0,0,0,  0,1,0,0,  0,0,1,0,  x,y,z,1]
            0 0 1 z
            0 0 0 1
```

### Scaling

```
S(sx,sy,sz) = sx 0  0  0    array: [sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1]
              0  sy 0  0
              0  0  sz 0
              0  0  0  1
```

### Multiply, and why order matters

`multiply(a, b)` returns `a × b`, which means **b is applied to the vertex first**. With
column vectors:

```
worldPosition = T × S × localPosition
                    ↑ applied first (stretch), then translate
```

If you swap them and compute `S × T`, the translation gets scaled too: a cube placed at
x = 30 with height 3 would land at x = 90. That is the single most common bug in this
exercise, and it is easy to check on screen — a `1a` grid built with the wrong order fans out
away from the origin instead of forming an even grid.

### Applying the matrix by hand

`writeCube()` does the multiply for one vertex, written out so the cost is obvious:

```js
const wx = model[0] * px + model[4] * py + model[8]  * pz + model[12];
const wy = model[1] * px + model[5] * py + model[9]  * pz + model[13];
const wz = model[2] * px + model[6] * py + model[10] * pz + model[14];
```

`model[12..14]` is the translation column. Because `T × S` puts the translation there
untouched, the cube's base lands exactly at `y = 0` and its top at `y = height`.

**Normals:** these cubes are only ever stretched along the axes, never rotated, so an
axis-aligned normal like `(0,1,0)` still points the right way after the transform. (With
non-uniform scaling in general you would transform normals by the inverse-transpose of the
model matrix. Not needed here — worth saying out loud in the write-up.)

---

## 3. Level 1a — translation into a grid

The grid is `n × n` cells on the x–z plane. For cell `(i, j)`:

```js
const half = (n - 1) / 2;
const x = (i - half) * SPACING;   // SPACING = 1
const z = (j - half) * SPACING;
```

Subtracting `half` centres the whole grid on the origin, so a 64 × 64 grid spans
`-31.5 … +31.5` in both directions rather than starting at 0. Centring matters for 1d: an
orbit around `(0,0,0)` should circle the middle of the terrain, not one corner.

At 1a every cube has `height = 1`, so you get a flat 64 × 64 × 1 slab. That is the point of
the tab: it isolates translation, so if the grid looks wrong you know the bug is in the
placement, not in the heights.

**Resolutions.** The buttons map to 16, 32, 64, 96 and 128 cells per side:

| n | cubes | vertices | buffer | measured rebuild |
| --- | --- | --- | --- | --- |
| 16 | 256 | 9,216 | 0.3 MB | 1–2 ms |
| 32 | 1,024 | 36,864 | 1.3 MB | 3–5 ms |
| 64 | 4,096 | 147,456 | 5.3 MB | 10–30 ms |
| 96 | 9,216 | 331,776 | 12 MB | ~27–29 ms |
| 128 | 16,384 | 589,824 | 21 MB | 55–60 ms warm, ~100 ms on the first build |

Because the draw is a single call, the frame rate barely changes between 16² and 128² — all
the cost is in the rebuild, which happens only when you press a button. If your numbers are
much worse, check that you are not assigning `canvas.width` every frame (that reallocates the
drawing buffer and can cost more than the entire scene).

---

## 4. Level 1b — heights by scaling in y

Each cube's own transform is:

```js
const model = multiply(translation(x, 0, z), scaling(1, height, 1));
```

`scaling(1, height, 1)` stretches only y, which is the axis orthogonal to the x–z plane.
Width and depth stay 1 so neighbouring cubes still line up exactly.

### The height procedure: value noise + fBm

Pure `Math.random()` per cell gives white noise — a field of unrelated spikes. It satisfies
the letter of the assignment but looks like static, not terrain. The landscape here is
built from **fractal Brownian motion over value noise**, which is about 30 lines and gives
smooth hills with detail on top.

**Step 1 — a deterministic hash per lattice point.** `hash(x, y)` uses a sine scramble to
turn integer coordinates into a pseudo-random 0..1 value. It is deterministic: the same
lattice point always gives the same number, so the landscape is identical on every reload
and at every resolution.

```js
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
```

**Step 2 — value noise: blend four lattice corners.** For a sample point inside a lattice
cell, take the four corner hashes and blend them bilinearly. Smoothstep the fractions
(`t²(3-2t)`) so the blend arrives with zero slope at each lattice point — otherwise the
terrain shows a visible crease on every cell boundary.

```
 a ───────── b        top    = lerp(a, b, u)
 │           │   →    bottom = lerp(c, d, u)
 c ───────── d        value  = lerp(top, bottom, v)
```

**Step 3 — fBm: add octaves.** One noise layer only has one hill size. Sum four layers,
each at double the frequency and half the amplitude, then divide by the total amplitude to
get back into 0..1:

```js
for (let octave = 0; octave < 4; octave++) {
  sum += amplitude * valueNoise(x * frequency, y * frequency);
  total += amplitude;
  frequency *= 2;
  amplitude *= 0.5;
}
return sum / total;
```

The result reads as big hills carrying smaller hills carrying fine bumps, which is what makes
it look like a landscape rather than a cauliflower.

**Step 4 — shape and scale into world units.**

```js
const u = i / (n - 1);                 // 0 on one edge, 1 on the other
let h = fbm(u * HILLS, v * HILLS);     // HILLS = 2.6 hills across the terrain
h = Math.pow(h, 1.8);                  // widen the valleys, sharpen the peaks
const height = shortest + h * (tallest - shortest);
```

with `tallest = span * 0.14` and `shortest = span * 0.012`, where `span = n * SPACING`.
Tying the heights to the terrain's width is what keeps a 16² grid and a 128² grid looking
like the same place: the tallest cube is always 14% of the width, and the camera distance is
also a multiple of the width.

### Sampling in grid space, not world space

The noise is sampled at `u, v ∈ [0,1]` across the terrain, **not** at world x/z. If you
sample at world coordinates, a coarse grid and a fine grid sample different parts of the
noise field, and changing resolution changes the landscape. Sampling in normalised grid
space means every resolution is the *same* terrain at a different sampling rate — the
resolution buttons become a fair performance comparison, which is exactly what 1a asks for.

`pow(h, 1.8)` is optional shaping. With a plain 0..1 noise sum, most of the map sits at
mid-height and the hills are soft. Raising it to a power above 1 pushes mid-values down, so
valleys get wide and flat while peaks stay sharp.

`heightField()` also returns `peak`, the tallest height it produced. That is the normalising
value for the colours in 1c, so the palette always uses its full range no matter how the
noise happened to fall.

---

## 5. Level 1c — colour per vertex

The colour rule is applied **per vertex**, not per cube. That is the whole point of the
exercise: if you assign one colour to the four corners of a face, every pixel on that face is
the same colour and nothing interpolates. Give each corner its own colour and the GPU blends
between them.

```js
paletteColor(wy / peak, vertexColor);   // wy = this corner's world height
```

Four stops, from valley floor to peak:

```js
const PALETTE = [
  [0.07, 0.16, 0.34],   // 0.00 deepest hollows  — deep blue
  [0.09, 0.40, 0.47],   // 0.33 lowland          — teal
  [0.36, 0.63, 0.36],   // 0.66 slopes           — green
  [0.93, 0.88, 0.70],   // 1.00 peaks            — sand
];
```

`paletteColor(t)` finds the two stops around `t`, smoothsteps the fraction between them, and
lerps. Using the same `t²(3-2t)` easing here as in the noise keeps the bands from having hard
edges where one palette segment meets the next.

### What the fragment shader does with it

The vertex shader declares `varying vec3 vColor` and passes the attribute straight through.
Between vertices, the rasteriser works out each pixel's **barycentric weights** — how much of
each of the triangle's three corners that pixel "belongs to" — and blends the three colours
with those weights. The blend is perspective-correct, so it follows the surface correctly in
3D. The fragment shader just receives `vColor` and multiplies it by light.

On a cube's side face, the two bottom corners share one colour and the two top corners share
a lighter one. The result is a vertical gradient across every side face, and each cube
restarts that gradient at its own base. On a steep hillside you see this as fine horizontal
banding — a direct visualisation of interpolation, and a good thing to point at in the
write-up. The top faces have one colour, so they stay flat, which makes the contrast obvious.

If you would rather have smooth terrain colour with no banding, colour the **whole cube** by
its own height (pass one colour for all 36 vertices) — but then 1c's interpolation note has
nothing to show. The per-corner version is the honest demo.

### A little lighting, so the cubes read as cubes

Normals come along for free, so the fragment shader does a single directional light:

```glsl
vec3 normal = normalize(vNormal);
float brightness = max(dot(normal, normalize(vec3(0.5, 1.0, 0.3))), 0.0);
float light = 0.3 + 0.7 * brightness;      // 30% ambient floor
gl_FragColor = vec4(vColor * light, 1.0);
```

`normalize` is required because `vNormal` is a varying: the rasteriser interpolated it, so
its length is no longer 1 except at the corners. Skipping the normalise darkens or brightens
triangles unpredictably.

---

## 6. Level 1d — the orbiting camera

The camera is described by `eye` (where it is), `target` (where it looks) and `up`
(which way is up, always `(0,1,0)`).

### The path

One angle that grows with time, converted to a point on a circle:

```js
const angle = time * ORBIT_SPEED;          // 0.22 rad/s ≈ one lap in 28.6 s
const radius = span * 1.2 * fit;
const eye = [Math.cos(angle) * radius, span * 0.45 * fit, Math.sin(angle) * radius];
const target = [0, 0, 0];
```

Both radius and height are proportional to `span`, so the framing is identical at every
resolution. `fit = max(1, 1.5 / aspect)` pulls the camera back on a narrow window: a tall
phone-shaped viewport has a small horizontal field of view, and without the adjustment the
sides of the landscape would be cropped.

Because the target is fixed at the centre and only `eye` moves, the camera continuously
re-aims at the middle of the landscape — "look at 0,0,0" — which is the requirement.
`near` and `far` also scale with `span`, so depth precision stays usable from a 16² grid to a
128² one.

### `lookAt`

```js
zAxis = normalize(eye - target);      // backwards: from target toward the camera
xAxis = normalize(up × zAxis);        // camera right
yAxis = zAxis × xAxis;                // camera up
view = [ xAxis  yAxis  zAxis  translation ]
```

The view matrix is the inverse of the camera's own transform: it rotates the world so the
camera sits at the origin looking down −z. The last column is `-dot(axis, eye)` for each axis.
Rebuilding it every frame from the moving `eye` is the entire "camera path" — there is no
animation system involved.

### Projection

```js
perspective(BASE_FIELD_OF_VIEW / state.zoom, canvas.width / canvas.height, near, far)
```

`BASE_FIELD_OF_VIEW` is 33° — a longer lens than the usual 45°, chosen so the landscape fills
more of a wide canvas instead of sitting in the middle of a black frame. Scroll-wheel zoom
divides it further (33° / 1.8 ≈ 18°), which magnifies without moving the camera. The aspect
comes from the canvas and near/far from the terrain size. This is what makes distant cubes
smaller and produces the strong sense of depth in the `1d` tab.

### The animation loop

```js
function loop(now) {
  draw((now - modeStart) / 1000);        // seconds since this tab started
  ...
  rafId = requestAnimationFrame(loop);
}
```

Time comes from the `requestAnimationFrame` timestamp, not a counter, so the orbit speed is
the same on a 60 Hz and a 144 Hz display. `modeStart` is captured on the first frame after a
tab change, which means every visit to `1d` starts the orbit from the same angle.

The still tabs (`1a`, `1b/c`) call `draw(0)` **once** instead of starting the loop. That is
worth copying: an unchanging scene does not need 60 draws a second, and it makes the frame
rate readout meaningful only where motion exists.

---

## 7. Rebuild vs redraw

There are two different operations and it pays to keep them separate:

- **`rebuild()`** — regenerate the big array and upload it (`gl.bufferData`). Runs only when
  the mode or resolution changes. Cost: 1–60 ms depending on size (the first build after a reload is slower while the
JavaScript engine warms up).
- **`draw(time)`** — set two uniforms and issue one `drawArrays`. Runs every frame in `1d`.
  Cost: roughly constant, independent of resolution.

`gl.bufferData` reallocates GPU memory, so calling it per frame would be disastrous. The
status readout measures `rebuild()` with `performance.now()`, which is how the table in
section 3 was produced.

`syncCanvasSize()` deliberately only touches `canvas.width/height` when the CSS size has
actually changed, because assigning either property clears the drawing buffer and the driver
has to reallocate it.

---

## 8. Rebuilding it yourself, in order

Write it in this sequence and check the screen after each step — every step is independently
visible.

1. **Static page.** A canvas that fills the window, a WebGL context, clear to a dark colour.
2. **Shaders + one cube.** Vertex shader takes position and normal, fragment shader does the
   directional light. Draw the 36-vertex unit cube with a hard-coded cube colour. You should
   see a shaded cube, no camera yet — positions in −0.5..0.5 will fill the frame oddly, which
   is fine.
3. **Matrices.** Add `perspective` and `lookAt` as uniforms, hard-code
   `eye = (5, 4, 6)`, `target = (0, 1, 0)`. The cube now sits in a perspective scene.
4. **Level 1a.** Add `translation` and `scaling`, plus `buildGrid(n)`. Loop the grid, bake each
   cube's vertices into one array, upload once, single `drawArrays`. Check: an even slab
   centred on the origin; no gaps if `SPACING = 1`; the whole grid visible.
5. **Level 1b.** Add `hash`, `valueNoise`, `fbm`, `heightField`. Multiply heights into the
   model matrix. Check: hills with no seams at cell boundaries; the same hills at 16² and 128².
6. **Level 1c.** Add `PALETTE` and `paletteColor`. Write a colour per vertex using that
   vertex's world y. Check: side faces have a visible vertical gradient; tops are flat.
7. **Level 1d.** Replace the fixed eye with `cos/sin` of a time-based angle, start a
   `requestAnimationFrame` loop, and re-upload nothing per frame. Check: the horizon stays
   centred, the camera goes all the way round, the near edge never clips through the terrain.
8. **Controls and readout.** Wire the tabs and resolution buttons to `rebuild()`; measure the
   rebuild duration; count frames over 500 ms for the fps figure.

### Things that will go wrong, and what they look like

| Symptom | Cause |
| --- | --- |
| Grid fans out toward the origin instead of staying even | `scaling × translation` instead of `translation × scaling` |
| Cubes grow downward through the floor | cube mesh centred on y = 0 instead of based at y = 0 |
| Terrain looks like TV static | `Math.random()` per cell instead of smooth noise |
| Terrain changes every time you change resolution | noise sampled in world space instead of 0..1 grid space |
| Visible creases every cell | missing smoothstep on the noise fractions |
| Faces look wrong from behind / flicker | depth test not enabled, or faces wound inconsistently |
| Colours flat, no gradient | one colour per cube instead of per corner |
| Frame rate collapses at 128² | rebuilding the buffer per frame, or 16k draw calls |
| Orbit crops the landscape on a tall window | no aspect-based `fit` on the radius |
| Landscape clipped when the camera comes close | `near`/`far` fixed instead of scaled with `span` |

---

## 9. Where to tune it

All in [index.js](index.js):

| Constant | Effect |
| --- | --- |
| `HILLS` (2.6) | how many big hills fit across the terrain |
| `HEIGHT_RATIO` (0.14) | tallest cube as a fraction of terrain width |
| `pow(h, 1.8)` | valley width vs peak sharpness |
| octave count (4) | amount of fine detail, at linear build cost |
| `PALETTE` | the four colour stops |
| `ORBIT_SPEED` (0.22) | radians per second of the camera path |
| `SPACING` (1) | gap between cube centres; > 1 gives visible separated cubes |

Two honest limitations to mention in the write-up: the colours repeat a gradient inside every
cube, which is deliberate for 1c but reads as banding; and the terrain, being one cube per
cell, has visible stair-steps by design at low resolutions.

---

## 10. What Level 2 replaces

Level 2 does not change any of this machinery. It swaps the two procedures:

- `heightField(n)` → sample the grayscale PNG at each cell; map 0–255 to
  `shortest … tallest`.
- `paletteColor(t)` → sample the colour PNG at the same cell and use that as the cube colour.

`buildGrid`, `writeCube`, the matrices, the orbit camera and the single-draw optimisation all
stay exactly as they are. That is a good sign the Level 1 structure is right: the data source
is a detail, and the geometry pipeline is the thing you are actually building.

Levels 2 and 3 are now implemented in [index.js](index.js); the companion document is
[level-2-3-walkthrough.md](level-2-3-walkthrough.md).
