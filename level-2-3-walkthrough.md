# Levels 2 and 3 — the mock versions, explained

This is the companion document to [index.js](index.js) for the two new tabs. Level 1 has its
own walkthrough in [level-1-walkthrough.md](level-1-walkthrough.md); this file picks up where
that one ends.

Both levels here are **mock versions**: small, deliberately simplified, and built so that every
important idea is visible in a short amount of code. Each section says exactly what was
simplified, so you know what a fuller version would add.

| Tab | What it shows | Level |
| --- | --- | --- |
| `2` | An island whose heights and colours come from two PNGs | Level 2: image data |
| `3` | The noise landscape plus cube islands, clouds and birds drifting on bezier curves | Level 3: skyscape |

Both use the grid buttons (`16² … 128²`). Level 2 keeps the static camera of `1b/c` so the
terrain fills the frame. Level 3 uses the same still framing — the objects move, the camera
does not — so the landscape is just as large, while the sky objects cross the top of the shot
and leave through its edges.

Scrolling over the canvas zooms in (up to 3.5×), and double-clicking returns to normal. Zoom
narrows the field of view rather than moving the camera, so it works the same way on the
static levels and on the orbiting Level 1d, and can never push the eye inside the terrain.

The whole app also uses a longer 33° base lens than the textbook 45°, so the scene sits larger
in the frame before any zoom is applied.

---

## 1. What is being mocked, and what is real

**Real, and worth learning from:**

- the whole image → pixels → per-cell average → height/colour pipeline
- the height mapping from 0–255 to world units
- cubic bezier motion with a wrap-around restart
- per-object model matrices, and the shader change that makes them possible

**Simplified for a mock:**

- **The image pair is generated**, not photographed. [tools/make-maps.mjs](tools/make-maps.mjs)
  writes both PNGs from one height array, so they are guaranteed to be aligned. The trade-off
  is that the "photo" looks like a painted map rather than a satellite image.
- **No gamma correction.** PNG bytes are sRGB; WebGL treats vertex colours as linear. Feeding
  the bytes straight through brightens midtones slightly. Correct handling means `pow(c, 2.2)`
  on load and `pow(c, 1/2.2)` at the end of the fragment shader — see §3.8.
- **No alpha compositing.** The maps are fully opaque. A transparent PNG would sample as
  `[0,0,0,0]` and produce black cubes.
- **The sky scene is five objects**, not a full ecosystem. Enough to show the curve, the
  per-object matrix and the restart, without a scene-graph to maintain.
- **No fog or fading** when an object leaves. It simply stops being drawn, then restarts.

---

# Level 2 — heights and colours from images

## 2. The two images

```
assets/color-map.png    512 × 512, RGB     the colour of each patch of ground
assets/height-map.png   512 × 512, gray    brightness = elevation
```

Both were produced by `node tools/make-maps.mjs`, which:

1. builds a height field from value noise multiplied by a radial island mask,
2. writes that field directly as the grayscale PNG,
3. looks each height up in a colour ramp (deep water → shallows → sand → grass → forest →
   rock → snow) and writes the result as the colour PNG.

Because step 2 and step 3 read the same number, a green pixel in the colour map is always the
same cell as a mid-gray pixel in the height map. That is the property the rest of the level
depends on. When you source your own pair, this is the thing that most often breaks.

The generator is dependency-free: PNG is a signature, an `IHDR` chunk, a zlib-compressed
`IDAT` chunk and an `IEND` chunk. Run it again with a different `SEED` for a new island.

## 3. From PNG to pixels

JavaScript cannot look inside a PNG directly. The browser only gives you pixels through a
canvas, so the loading path is:

```
new Image()  →  img.onload  →  drawImage into an off-screen <canvas>
             →  ctx.getImageData(0, 0, w, h).data      // Uint8ClampedArray, RGBA
```

That is `loadPixels()` in [index.js](index.js). Four details matter:

- **Draw at `naturalWidth`/`naturalHeight`.** If the image is laid out by CSS at some other
  size, `drawImage(img, 0, 0)` still uses the intrinsic size — but if you pass explicit
  dimensions you must pass the natural ones, or you sample resampled pixels.
- **Read once, keep the array.** `IMAGE_MAP` holds both results. Re-reading the canvas on
  every grid change would waste tens of milliseconds for no reason.
- **A cross-origin image taints the canvas**, and `getImageData` then throws a security error.
  This is why the page must be served over `http://` (the preview server on port 8123) rather
  than opened as a `file://` URL, and why `crossOrigin = 'anonymous'` is needed if the PNG ever
  moves to another host.
- **Loading is asynchronous.** `buildImageGrid()` returns `null` until both images are ready;
  `rebuild()` falls back to the noise landscape, and the load callback rebuilds in place if
  you are already on tab 2. The status readout says `loading maps…`, then `maps sampled`.

## 4. Sampling: "100 × 100 grid, 1000 × 1000 image"

Each cell owns a block of the image. With the mock assets at 64 × 64, a cell covers
`512 / 64 = 8` pixels per side, so **64 pixels** are reduced to one height and one colour. At
16 × 16 the block is 32 × 32 = 1,024 pixels; at 128 × 128 it is 4 × 4 = 16.

Three ways to reduce a block:

| Method | What it does | When it is right | Problem |
| --- | --- | --- | --- |
| Nearest | read the pixel under the cell centre | image and grid are the same size | thin features vanish or flicker |
| Box average | average every pixel in the cell | image larger than grid (our case) | softens sharp edges |
| Bilinear | blend the four nearest pixels | image smaller than grid | needs an upsampling path |

The code uses the box average:

```js
const brightness = averageChannel(height, u0, u1, v0, v1, 0);
sampleCellColor(color, u0, u1, v0, v1, cellColor);
```

`u0 … u1` and `v0 … v1` describe the cell in 0–1 image space. `averageChannel` converts them to
pixel columns and rows, clamps the range, sums the channel and divides by the count. If the
range is ever empty (a grid finer than the image), the clamp produces one pixel rather than a
division by zero.

Consequences worth knowing:

- **Total sampling cost tracks the image, not the grid.** Every pixel is touched once per
  image per rebuild, whatever the resolution. That is why the 128² build below is not 64× the
  cost of the 16² build.
- **Borders can overlap by a pixel** when the grid does not divide the image evenly (96² over
  512 px gives 5.33 px per cell). The over-count is invisible here. A fully correct version
  would weight each pixel by how much of it lies inside the cell.
- **The same footprint is used for height and colour**, which is what keeps them in step.

## 5. Heights: 0–255 into world units

The mapping is three lines:

```js
const shortest = span * 0.012;                 // sea floor, scaled to the terrain
const tallest  = span * HEIGHT_RATIO;          // 0.14 of the terrain width
const h = shortest + Math.pow(brightness, 1.0) * (tallest - shortest);
```

Worked example, 64 × 64 grid (`span = 64`):

| Step | Value |
| --- | --- |
| brightest pixel in the map | 184 (of 255, from the generator's report) |
| normalised brightness | 184 / 255 = 0.722 |
| `shortest` | 64 × 0.012 = 0.768 |
| `tallest` | 64 × 0.14 = 8.96 |
| resulting height | 0.768 + 0.722 × 8.192 = **6.68 world units** |

Why those constants:

- **`tallest` is a fraction of the width, not an absolute number.** The camera's radius,
  height, near and far are all derived from `span` too, so every resolution frames identically.
  Absolute heights would make 16² look like spikes and 128² like a pancake.
- **`shortest` is not zero.** Zero-height cubes collapse into degenerate triangles that can
  z-fight with their neighbours' bases, and flat sea would disappear. 1.2% of the width keeps
  the sea floor as visible, short cubes.
- **The height map has a range of 14–184**, not 0–255, because the island never reaches the
  very top of the ramp. The terrain therefore tops out at 72% of `tallest` — which is why the
  peak looks like a plateau rather than a spike. A photographic height map often behaves the
  same way; that is a property of the *image*, not of the mapping.
- **`IMAGE_HEIGHT_GAMMA`** exists so you can bend the mapping without touching the formula.
  `1.0` is linear. Try `0.6` to lift the lowlands, or `1.6` to exaggerate valleys.

## 6. Colour, and what happened to interpolation

The colour map is sampled exactly like the height map, averaged over the same footprint, and
the result is written to **all 36 vertices of that cube**. That is the `'flat'` colour mode in
`writeCube`.

This changes the visual story from Level 1c. There, each corner got the palette colour for its
own height, so every side face carried a vertical gradient. Now a face is internally flat, and
the only thing still varying across a triangle is the **lighting term**. The fragment shader is
still interpolating `vColor` and `vNormal`; `vColor` simply no longer differs from corner to
corner.

If you want both, keep the image colour for the cube's top corners and multiply it by 0.65 for
the bottom corners. You keep the photo's detail *and* get shaded sides.

## 7. Orientation: the flip

Image row 0 is the top of the picture. Grid row `j = 0` is the far edge (`z = -half`). To make
the image's top edge appear at the far edge of the terrain, the sampler flips `v`:

```js
const v0 = 1 - (j + 1) / n;
const v1 = 1 - j / n;
```

Miss this and the island is mirrored north-to-south. On a symmetric blob it is hard to notice;
on a coastline with a colour map it is instantly wrong, because the hills end up in the sea.

## 8. Resolution ladder and measured cost

The buttons are the "start low, increase toward target" control the assignment asks for.
Measured on this machine, tab 2, after the images have decoded:

| Grid | Cubes | Cell footprint | Rebuild (warm) |
| --- | --- | --- | --- |
| 16² | 256 | 32 × 32 px | 4–5 ms |
| 32² | 1,024 | 16 × 16 px | 6–8 ms |
| 64² | 4,096 | 8 × 8 px | 14–24 ms |
| 96² | 9,216 | ~5.3 × 5.3 px | 29–30 ms |
| 128² | 16,384 | 4 × 4 px | 50–63 ms (91 ms on the first, cold build) |

The jump at 128² is mostly writing 590,000 vertices (16,384 × 36), not sampling. Frame rate is
the same as Level 1 because the draw is still one call.

## 9. Using your own images

Requirements:

1. **Two PNGs with the same dimensions and the same crop.** Export them from the same view of
   the same place. If they disagree, no amount of code will line them up.
2. **Opaque.** No alpha, no palette-with-transparency.
3. **The height map must be grayscale.** A colour image will be read from its red channel,
   which happens to be the luminance for most greyscale exports but is not guaranteed.
4. **Reasonable size.** 512² or 1024² is plenty. A 4K map costs 64 MB of RGBA and a long decode
   for no visible gain at 128 cubes across.

To swap them in: replace `assets/color-map.png` and `assets/height-map.png`, keep the
filenames, reload. Then tune in [index.js](index.js):

| Constant | Effect |
| --- | --- |
| `HEIGHT_RATIO` (0.14) | how tall the tallest cube is, relative to terrain width |
| `IMAGE_HEIGHT_GAMMA` (1.0) | lowland lift vs valley exaggeration |
| `0.012` in `buildImageGrid` | minimum height for the brightest-black cells |

If the result looks flat, check the height map's histogram before touching the code: a photo's
depth map often spends most of its range in the midtones, and no gamma setting will create
detail that is not in the file.

**Deliberate limitation:** the colours are used as-is in sRGB space. To be strictly correct,
convert to linear on load (`c = pow(c/255, 2.2)`) and back at the end of the fragment shader;
otherwise lighting multiplications happen in the wrong space and shadows drift muddy. It is a
two-line fix, left out here so the mock stays focused on sampling.

---

# Level 3 — a skyscape on bezier curves

## 10. The scene

Five objects, 33 cubes in total, all built from the same unit cube:

| Object | Cubes | Shape |
| --- | --- | --- |
| island | 15 | 3 × 3 grass top, tapered rocky underside, one tree |
| cloud A, cloud B | 5 each | overlapping white blocks |
| bird A, bird B | 4 each | body, two flat wings, head |

They are defined in `SKY_DEFINITIONS` as arrays of `{ x, y, z, size, color }`. Per-axis sizes
(`sx`, `sy`, `sz`) are allowed, which is how the bird gets flat wings while the island stays
cubic.

## 11. One buffer per object, one model matrix per frame

The landscape bakes its transform into the vertex data, because it never moves. A sky object
*does* move, so baking would mean rebuilding its buffer every frame. Instead:

1. `buildCluster()` packs an object's cubes into a buffer **once**, in local space — a few
   units across, centred on its own origin.
2. Every frame, `drawSky()` computes a model matrix

   ```
   model = T(position on curve) × R_y(spin) × S(span × scale)
   ```

   and uploads it with `gl.uniformMatrix4fv(uModel, …)`.
3. The vertex shader applies `uModel` to the position and its `mat3` to the normal:

   ```glsl
   vNormal = mat3(uModel) * aNormal;
   gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
   ```

The landscape still draws with `uModel = identity`, so nothing about Level 1/2 changes except
that it now goes through a matrix that happens to be the identity.

Why `mat3(uModel)` is enough for normals: the model contains translation (ignored by a 3×3),
rotation, and **uniform** scale. A uniform scale changes a normal's length but not its
direction, and the fragment shader already calls `normalize()`. Non-uniform scale would require
the inverse-transpose, which is why per-cube stretches are baked into the cluster geometry
instead of living in the model matrix.

Draw calls per frame: **6** — one for the landscape, five for the sky objects. Cube count is
irrelevant to the CPU cost here; only the number of buffers is.

`useGeometry(buffer)` re-points the attribute pointers whenever the bound buffer changes. That
is the price of having more than one buffer, and the reason the function exists.

## 12. The bezier curve

A cubic bezier is defined by four control points. The implementation is the standard
Bernstein form:

```js
B(t) = (1-t)³·p0 + 3(1-t)²t·p1 + 3(1-t)t²·p2 + t³·p3
```

The four weights — `u³`, `3u²t`, `3ut²`, `t³` — always sum to 1, so `B(t)` is a weighted
average of the control points. Two immediate consequences:

- `B(0) = p0` and `B(1) = p3`: the curve starts and ends exactly on the outer control points.
- `p1` and `p2` are *pulls*, not points on the curve. The path bends toward them without
  reaching them.

At `t = 0.5` all four weights are `1/8, 3/8, 3/8, 1/8`, so the midpoint is

```
B(0.5) = (p0 + 3·p1 + 3·p2 + p3) / 8
```

The island's control points are (in fractions of the terrain width):

| Point | x | y | z |
| --- | --- | --- | --- |
| p0 | -1.62 | 0.33 | 0.55 |
| p1 | -0.50 | 0.43 | 0.50 |
| p2 | 0.40 | 0.31 | -0.30 |
| p3 | 1.20 | 0.37 | -1.55 |

so its midpoint is `[-0.09, 0.365, -0.05]`. `p0` and `p3` are deliberately **outside the
camera frustum**: the island enters from the left edge, crosses in front of the landscape and
leaves past the right edge. That is the whole trick behind a loop that does not pop — the
reset from `p3` back to `p0` happens while the object is off-screen.

Why cubic rather than quadratic: two inner control points give independent control of the
start and end tangents. Moving `p1` changes how the object leaves its starting point without
disturbing how it arrives.

## 13. Making it move, then restart

```js
const t = (time * object.speed + object.phase) % 1;
if (t > object.hideAfter) continue;
```

- **`time`** is seconds since the tab was opened, so all objects share a clock and stay in
  relative sync.
- **`speed`** is "fraction of the curve per second". Island `0.018` → 55.6 s per pass; clouds
  `0.028` and `0.021` → 35.7 s and 47.6 s; birds `0.09` → 11.1 s.
- **`phase`** offsets the start so objects do not launch together. It is also used as a spin
  offset, which keeps the two clouds from looking like clones.
- **`% 1`** wraps the parameter. When `t` passes 1, the next frame starts it at 0 again, and
  because both ends of every curve are outside the frustum, the jump is never visible: the
  object has "gone far away" and restarts from its original spot off-screen.
- **`hideAfter`** is `1` for all five objects, so it never cuts a visible object. It exists as
  a safety hatch: if a path does end inside the frame, setting it to `0.96` removes the object
  for the last few percent of the curve instead of letting it jump across the screen.

The object's spin is independent of the path: `rotationY(time * spin + phase * 2π)`. A cloud
with `spin: 0.05` turns once every two minutes, which reads as slow drift rather than rotation.

## 14. Scale, and why it is tied to `span`

```
size = state.span * object.scale      // island 0.075, clouds 0.055/0.04, birds 0.028/0.023
```

The cluster is a few units wide in local space. Multiplying by the terrain width means the
skyscape keeps the same proportion at every grid resolution, and the camera — whose eye and
target already scale with `span` — frames it the same way. Set absolute sizes and the island
is a speck at 128² and a moon at 16².

## 14b. Keeping the camera still, and filling the frame

Level 3's mode entry is `orbit: false, animated: true`. Two separate flags matter here:

- `animated` starts the `requestAnimationFrame` loop, because the sky objects still move.
- `orbit` controls the camera path in `cameraFor`. With it off, the level uses exactly the
  static terrain camera: `eye = [0.97, 0.69, 1.17] × span`, `target = [0, 0, 0] × span`.
  Sharing that framing is what makes the landscape as large in tab 3 as it is in tab 2; the
  sky objects then cross the top of that shot and leave through its edges.

That framing is also part of a deliberate **lens change**: `BASE_FIELD_OF_VIEW` is 33° rather
than the usual 45°. A longer lens makes the same scene fill more of the canvas, and the
terrain cameras were pulled in to match — orbit radius 1.2 span at height 0.45, static eye
`[0.97, 0.69, 1.17]`. The single-cube tab is the exception: its camera sits at
`[7.0, 5.3, 8.7]`, which is the original distance stretched by
`tan(45°/2) / tan(33°/2) ≈ 1.4`, so the cube keeps exactly the apparent size it had before
the lens change. At 1280 × 579:

| Tab | Background | Content box (width × height) |
| --- | --- | --- |
| `0` | 94% | 18% × 41% — the original framing, deliberately unchanged |
| `1a`, `1b/c`, `2` | 75% | 65% × 70% |
| `1d` | 57% | 96% × 60% |
| `3` | 74% | 65% × 70% terrain; 88% × 98% with the sky objects crossing the edges |

A square landscape on a 2.2:1 canvas cannot fill both dimensions without cropping, so the
remaining margins are the honest trade-off. In Level 3 the sky objects deliberately cross the
boundary: they are clipped by the canvas edge while entering and leaving, which is the effect
we want rather than a glitch. Portrait windows get a
`fit` factor (`max(1, 1.5 / aspect)`) that pulls the camera back so the terrain width is not
cropped.

Zoom is a **narrower field of view**, not a dolly:

```js
perspective(BASE_FIELD_OF_VIEW / state.zoom, aspect, camera.near, camera.far)
```

- Wheel up (negative `deltaY`) multiplies `state.zoom` by `exp(-deltaY × 0.0015)`, clamped to
  1–3.5×; the wheel listener is non-passive so it can call `preventDefault()`.
- Because the camera does not move, zooming into an orbiting camera or a still one is safe:
  the eye never enters the cube field, and near/far planes need no adjustment.
- The zoom state is shared and standardised: the same 1–3.5× range and the same FOV math on
  every tab, and **switching levels resets it to 1×**, so each level opens at its standard
  framing. The status line appends e.g. `1.8× zoom` only while zoomed.
- Double-click resets `zoom` to 1 within the current level.
- Static modes redraw once through `refreshView()`; animated modes let the loop pick it up on
  the next frame.

## 15. Adding another object

1. Write a cube list in local space, using `size` or `sx`/`sy`/`sz` and a colour array.
2. Add an entry to `SKY_DEFINITIONS` with four control points, a `scale`, `speed`, `phase`,
   `spin` and `hideAfter`.
3. Reload. `createSkyObjects()` builds the buffer; `drawSky()` handles the rest.

To make an object follow a different kind of path, replace `bezierPoint()` with another
function of `t` that returns `[x, y, z]` — a circle is `[r·cos(2πt), y, r·sin(2πt)]`. Nothing
else in the drawing code knows what kind of curve it is.

---

## 16. Rebuild order, from a working Level 1

1. **Level 2, loading.** Add `loadPixels()` and confirm both PNGs decode to arrays of the
   expected size (`512 × 512 × 4` bytes). Log one pixel.
2. **Level 2, sampling.** Write `averageChannel()` and check it against a hand-computed block:
   a 32 × 32 block at 16² should average 1,024 pixels.
3. **Level 2, build.** Copy `buildGrid` into `buildImageGrid`, replace the height with the
   sampled brightness mapped through `shortest … tallest`, and replace the palette with the
   sampled colour written flat.
4. **Level 2, tab.** Add the mode, enable the button, update the status text.
5. **Level 3, shader.** Add `uModel`, get the uniform location, multiply in the vertex shader.
   Confirm Levels 0–2 still render with `uModel` set to the identity.
6. **Level 3, buffers.** Add `buildCluster()` and draw one static object at the origin before
   animating anything.
7. **Level 3, curve.** Add `bezierPoint()`, log `B(0)`, `B(0.5)`, `B(1)` and check they match
   the control points and the weighted average.
8. **Level 3, motion.** Add `t`, `speed`, `phase`, the `% 1` wrap and `hideAfter`, then the
   per-frame model matrix.

## 17. Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Black cubes where the image is transparent | sampled alpha was ignored, RGB is 0 | require opaque maps, or composite onto a colour |
| "The operation is insecure" / `getImageData` throws | cross-origin image tainted the canvas, or opened from `file://` | serve over http, set `crossOrigin` |
| Terrain is mirrored north-to-south | image row 0 treated as the near edge | flip `v` (`1 - j/n`) |
| Image looks stretched | non-square image mapped onto a square grid | crop to a square, or accept the stretch deliberately |
| Terrain is a flat sheet | height map histogram is concentrated in the midtones | check the histogram; adjust gamma, or the source map |
| Every cube is the palette colour, not the image | mode still uses `colors: 'height'` | use `'flat'` with the sampled colour |
| Sky objects are invisible | drawn before the camera matrices, or scale is zero | draw after the terrain, keep `scale > 0` |
| Sky objects flicker out early | `hideAfter` too low for the speed | use `1`; let the path end off-screen instead |
| Object pops when its pass restarts | an endpoint of the path is still inside the frustum | extend `p0`/`p3` beyond the frame edge |
| Sky objects appear stretched at 128² | absolute scale in world units | multiply by `span` |
| Normals wrong on sky objects | non-uniform scale in the model matrix | bake stretches into the cluster, keep the model uniform |

## 18. What was verified

In the browser, on the running page:

- Both maps decode to 512 × 512; `IMAGE_MAP.status` is `ready`; `gl.getError()` is 0 on every
  tab.
- Tab 2 at 64²: a pixel at the centre of the canvas reads `[60,103,55]` (forest green), the
  lower area reads `[9,37,66]` (sea), and the corner reads the background colour — the island
  and its surrounding water are both present.
- Tab 2 rebuilds (warm): 4–5 ms, 6–8 ms, 14–24 ms and 50–63 ms for 16²/32²/64²/128²; the
  first build after a reload costs about 40% more while the JavaScript engine warms up.
- Tab 3: `bezierPoint` returns exactly `p0` at `t = 0` and `p3` at `t = 1`, and
  `[-0.09, 0.365, -0.05]` at `t = 0.5` for the island.
- Tab 3: the camera stays still while objects move — 5,915 pixels brighter than 150 (cloud
  tops and snow) in one frame at t = 8 s.
- Tab 3 entry/exit: every path starts and ends outside the frame (island NDC x −1.17 → 1.53,
  cloud A −1.34 → 1.40, cloud B y 1.22 → x 1.49, birds −1.14 → 1.55), so the wrap is invisible
  while the objects slide in and out across the canvas edges.
- Framing at 1280 × 579: content occupies 18% × 41% (single cube, its original framing),
  65% × 70% (static terrain), 96% × 60% (orbit) and 65% × 70% terrain / 88% × 98% with the
  sky objects (skyscape) of the canvas.
- Zoom: one wheel event of −400 gives 1.82×, repeated events clamp at 3.5×, double-click
  returns exactly 1, and switching levels also returns it to 1. On the static Level 2 tab the
  canvas redraws immediately (a corner pixel that was background becomes terrain after
  zooming), and `1d` still orbits.
- All six working tabs (`0`, `1a`, `1b/c`, `1d`, `2`, `3`) switch cleanly, at both 64² and
  128², with no WebGL errors.

The frame-rate readout shows ~30 fps in this environment, which is the headless browser's
`requestAnimationFrame` ceiling, not the scene's limit; the draw is six calls per frame either
way.

## 19. Things to try next

- **Halve the map resolution** (run the generator with `SIZE = 128`) and look at 128². You are
  now sampling one pixel per cube; the island gets blockier and the averaging stops mattering.
- **Switch the sampling mode** to nearest-neighbour and compare. Thin beaches and lone peaks
  will start to appear and disappear as you change the grid size — the clearest demonstration
  of why averaging is the right default.
- **Give the island a height map of its own**: use the sampled height to offset the island's
  local cubes, so the sky object is terrain too.
- **Add a bezier curve for the ground** (Level 3, Option 2): sample heights along a curve
  instead of from noise, and compare with the image-driven heights from Level 2.
- **Draw the path**: add small cubes at `bezierPoint(path, k/32)` for `k = 0…32`, in a faded
  colour, to see the curve the object follows.
- **Fade instead of hide**: give the shader an alpha uniform and ramp it down over the last 5%
  of the curve. That needs blending, depth-write off and a draw order — a good next exercise.
