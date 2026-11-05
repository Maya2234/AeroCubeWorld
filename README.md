# Cube World Aero

- **Live app:** https://maya2234.github.io/AeroCubeWorld/
- **Source code:** https://github.com/Maya2234/CGProject2
- **Demo video:** http://localhost:4322/projects/cube-world-aero

## Design
I want to make a green natural field landscape for early levels, and incorporate water, hills, and buildings as landscape increases in complexity. I want to add butterflies, clouds, and bubbles for the motion aspect.

styled after the early-2000s *Frutiger Aero*: bright skies, glossy glass buttons, bubbles, green hills, clean white towers.

- Interface: glossy pill buttons, XP-style message
  windows, aqua glass cursors.

<img width="736" height="414" alt="image" src="https://github.com/user-attachments/assets/e821006c-338e-460e-a96d-71554ca4ba75" />
<img width="736" height="736" alt="image" src="https://github.com/user-attachments/assets/12d81263-6a95-4ea5-a4af-92b2d9572e93" />

---
### Levels

| Tab | What it shows | New idea |
|---|---|---|
| **Unit → Cube** | One 2 × 2 × 2 cube | A 3D object as triangles; the camera |
| **Unit → Grid** | A flat grid of cubes | Translation (copying the cube across a grid) |
| **1** | Rolling cube hills | Scaling, procedural noise heights, per-vertex colour |
| **2** | An island city | Heights and colours read from two images |
| **3** | The city with a living sky | Clouds, butterflies and bubbles on Bézier curves |
| **4** | A whole city to explore | Haze, a rainbow, a steerable camera, blowing bubbles |

<img width="1911" height="868" alt="image" src="https://github.com/user-attachments/assets/f7dbed84-8eda-4679-a93a-060b5889da2d" />
<img width="1917" height="862" alt="image" src="https://github.com/user-attachments/assets/ac9492d9-c928-49f4-ad92-2913511847eb" />
<img width="1917" height="867" alt="image" src="https://github.com/user-attachments/assets/49c3099c-ddf6-489f-9439-d4b8b8de9b4c" />
<img width="1917" height="861" alt="image" src="https://github.com/user-attachments/assets/420fcfd0-ea87-42b7-8e2a-134345782a13" />

### Controls

| Control | What it does |
|---|---|
| Tabs (top right) | Switch level |
| **Cube / Grid** switch | Inside the Unit tab |
| **Grid** buttons | Grid resolution, from 16 × 16 to 128 × 128 cubes |
| **+ / 1.0× / −** | Zoom in, reset, zoom out (also: mouse wheel, or the **↑ / ↓** arrow keys). Resets on each level. |
| **Orbit** | Circle the camera around the scene; shows a pause sign while running. Pausing keeps the camera where it stopped. Every level opens already orbiting. |
| Dock capsule (centre of the bar) | Hide the whole bar for a full-screen view, and bring it back |
| Drag the scene | Turn and tilt the camera (any level) |
| Double-click the scene | Back to the normal view |
| **Level 4 only:** right-drag or Shift-drag | Slide the camera across the city |
| **Level 4 only:** click or tap | Blow a bubble in front of the camera |

Switching levels resets the zoom and any dragged view. The first time Level 4
opens, a hint and an "Immerse yourself" message box appear; the box can be
dragged anywhere and closes with **OK**.

The info bar shows how long the scene took to build and the frame rate

<img width="1911" height="168" alt="image" src="https://github.com/user-attachments/assets/f36fc958-1fe7-470a-b864-4d228a0ecba5" />
<img width="1917" height="292" alt="image" src="https://github.com/user-attachments/assets/1cebfb6e-5d29-474d-961b-b9d9f4d0eb3f" />
<img width="332" height="242" alt="image" src="https://github.com/user-attachments/assets/1c2bf57b-4f43-4022-a42d-d2e32bb9bba6" />

---

### 3D objects as vertices, edges and triangles
Everything on screen is triangles. The **unit cube** is 36 vertices: 6 faces,
2 triangles each, 3 corners each. Every vertex carries a **position**, a
**normal** (which way its face points) and a **colour**, packed side by side
in one array: 9 numbers per vertex.

The city is that same cube copied thousands of times, so the whole landscape
is **one buffer drawn in one call**. Bubbles are spheres built from rings of
triangles, and the rainbow is a ring of thin triangle wedges.

### Transformations
Each object is placed with **4 × 4 matrices**: translation (move), scaling
(stretch a cube into a tower) and rotation (turn a butterfly to face where
it's flying, spin turbine blades). Matrices multiply in order, so
"scale, then move" is `translate × scale`.

### The pinhole camera
The view follows the **pinhole camera model**:

- a **look-at** matrix places the eye and aims it at a target
- a **perspective** matrix projects 3D onto the screen: farther things shrink
- **zoom** narrows the field of view, like a longer lens. The camera doesn't
  move, so zooming can't push it into the scene.
- **Orbit** and Level 4's steering move the eye around the target in
  spherical coordinates (an angle around, an angle up, a distance).
- **Clicking** runs the camera in reverse: a ray from the eye through the
  clicked pixel says where in 3D the bubble goes.

### Triangle drawing (rasterization)
The GPU fills each triangle pixel by pixel. Values set at the three corners,
like colour, are **blended across the triangle**: that's why Level 1's cubes
fade from dark at the base to bright at the top. A **depth buffer** keeps
whatever is nearest at each pixel, so hidden faces stay hidden.

### Line drawing
Roads and the river are drawn into the city maps as **thick lines**. Each
curve is flattened into short straight segments, and a pixel is road if it's
within the road's half-width of the nearest segment.

### Shading
The fragment shader lights every pixel:

- **diffuse** light from the angle between the face and the sun, plus
  **ambient** so shadows aren't black
- a **specular highlight** for the glossy city
- **bubbles:** clear in the middle and bright at the rim, with a rainbow film
  tint. They're drawn see-through with **alpha blending**, sorted back to front.

### Procedural terrain: noise
Level 1's hills are **value noise**: random heights at grid points, smoothly
blended between. **Fractional Brownian motion** stacks several layers, each
twice as detailed and half as tall, for natural-looking hills.

### Images as data
Levels 2–4 read a **height map** and a **colour map** (PNG files made by
`tools/make-city-maps.mjs`). Each cube reads **one pixel**. An earlier version
**box-filtered** (averaged every pixel under the cube), which blurred small
features like single trees.

### Curves
Clouds drift along **cubic Bézier curves**. Bubbles and butterflies loop over
the meadow on closed paths of joined Béziers (Catmull-Rom), and hover just
above the ground beneath them.

### Atmosphere
Level 4 fades distant ground into the sky colour behind it (**distance
haze**), so the city runs off toward the horizon instead of ending at an edge.
The haze is complete by the point where the camera's line of sight leaves the
map, and a flat sheet of grass (two triangles) carries the ground on past the
last cubes, so the end of the map never shows.

---

## Future work

- **Lighting:** a moving sun and real shadows.
- **Touch gestures:** pinch to zoom, two-finger pan on phones.
- **Performance:** draw only the cubes in view, to allow bigger cities.
- ability to add elements like hills, buildings
- simulated characters who drive, walk, swim 
---
