# Project 0 — Header Bar Template

A fill-in-the-blanks template for the header the assignment asks for:
**a title, your name, and space for information about your project.**
Nothing here is code — it is the layout, the copy, and the behaviour you are
describing and then building yourself.

---

## 1. What the header has to do

1. Show the **title**, **your name**, and **project info** without scrolling.
2. Not fight the WebGL canvas. The cube is the star; the header is the frame.
3. Leave room to grow, because later levels add a **level selector**
   (0 / 1a / 1b-c / 2 / 3 / 4) and per-level controls. If the header is
   designed badly now, every level after this one has to be re-laid-out.

---

## 2. Layout sketch

Two rows, fixed to the top, canvas fills everything below.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  COURSE · WEBGL CUBE LANDSCAPES                    ┌───┬────┬──────┬───┬───┬───┐│
│  Cube Landscape                    (title)        │ 0 │ 1a │ 1b/c │ 2 │ 3 │ 4 ││
│  by YOUR NAME                                      └───┴────┴──────┴───┴───┴───┘│
│                                                                               │
│  [One-line summary of this project]           ⓘ About this project  ▾         │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│                              ( WebGL canvas )                                 │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

Three zones, left to right / top to bottom:

| Zone | Contents | Purpose |
|---|---|---|
| **A — Identity** (left) | Eyebrow: course + assignment. Title: big. Byline: "by Your Name". | Satisfies title + name immediately. |
| **B — Level tabs** (right, aligned to the title row) | Numbered strip: `0 · 1a · 1b/c · 2 · 3 · 4`. Only the current one is active. | Grows with the assignment instead of being bolted on later. |
| **C — Info space** (second row, full width) | One line always visible (summary / tool stack / resolution). A disclosure toggle reveals the longer project description. | "Space for information" without a header that swallows the cube. |

### Variant A vs Variant B

- **Variant A — header as a layout row (recommended for Project 0).**
  Header is normal flow at the top; the canvas takes the remaining height.
  No overlap bugs, no pointer-event traps, canvas aspect ratio is honest.
- **Variant B — floating glass overlay on top of a full-screen canvas.**
  Looks better once the scene is busy (Level 3 sky objects, camera path).
  Costs you: the canvas must ignore the header strip when sizing the cube,
  and the header needs to sit above the canvas in stacking order. Defer this
  until the scene itself is the thing worth showing off.

---

## 3. Copy template (fill in the brackets)

Paste-and-edit block. Keep it short — the header is a signpost, not a report.

```
Eyebrow:     [COURSE CODE] · WebGL Cube Landscapes · Project 0
Title:       [PROJECT TITLE]                     e.g. Cube Landscape
Byline:      by [YOUR NAME]
Summary:     [One sentence. What is on screen right now?]
Meta:        HTML · CSS · JavaScript · WebGL    |    Level 0 · single 2×2×2 cube
```

About panel (the "space for information" — 3–5 short lines):

```
What this is:
  [One sentence: a single 2×2×2 cube rendered from scratch in WebGL,
   no libraries.]

How it is built:
  [Cube geometry as 36 vertices, one vertex + one normal per corner,
   perspective and look-at matrices, per-face lighting in the fragment
   shader.]

What to try / what comes next:
  [Nothing moves yet. From Level 1 the same cube is instanced across a
   grid, scaled into a landscape, and orbited by a camera.]

Performance:
  [Runs on any laptop with a WebGL-capable browser. Later levels use a
   cube grid up to N×N and will need a reasonably fast GPU.]
```

---

## 4. Visual spec (in words, so you can write the CSS yourself)

- **Height:** ~120 px on desktop (two rows), never more than 20 % of the
  viewport height. On short windows, collapse to the single title row (~64 px)
  and push the info line into the About panel.
- **Type scale:** title 28–32 px, semibold; eyebrow 11–12 px, uppercase, wide
  letter-spacing, muted; byline 14–16 px; info line and About body 13–14 px.
  Keep body measure to 60–70 characters so the paragraph stays readable.
- **Colour:** a near-black bar, not pure black — something like `#0b0d10`
  against the canvas `#000`. One 1-px hairline along the bottom edge at very
  low white opacity. Body text near-white, secondary text ~60 % grey, and
  exactly **one** accent hue used only for the active tab. Contrast of body
  text should hit 4.5:1.
- **Spacing:** 24 px side padding on desktop, 16 px on narrow screens; keep
  everything on an 8-px rhythm so the two rows don't look improvised.
- **Sticky:** stays pinned while the scene scrolls/animates. If you add a
  camera path later, the header must not be re-laid-out every frame — no
  layout reads inside the render loop.
- **Responsive:**
  - ≥ 900 px: two rows as sketched.
  - 600–900 px: drop the eyebrow, title shrinks, tabs move under the byline.
  - < 600 px: tab strip becomes horizontally scrollable (never wraps to two
    lines), About becomes a full-width disclosure, info line truncates to the
    summary only.

---

## 5. Behaviour and interaction

- **Level tabs:** Level 0 is active; the rest exist but are visibly muted and
  not clickable yet, with a tooltip like "arrives in Level 1". This tells the
  grader the structure is already there, and stops you from re-designing the
  header four times.
- **Active state:** the active tab is distinguishable by more than colour
  alone (weight + underline/inset bar) so it survives a colourblind check.
- **About panel:** single toggle, remembers its state on reload. Closed by
  default on small screens, open by default on wide ones.
- **Keyboard:** tabs in the natural tab order, visible focus ring, `aria-current`
  on the active one. The header must not swallow keyboard shortcuts meant for
  the canvas (arrow keys, space), so don't make the header focusable as a whole.
- **Pointer:** in Variant A the canvas starts below the bar, so you never have
  to think about this. In Variant B the bar must only capture clicks on its own
  pixels, never the empty area beside it, or camera-dragging will feel broken.

---

## 6. Traps worth avoiding

- Black bar on black canvas with no hairline → header reads as a void.
- Long project paragraph inside the always-visible row → cube gets pushed
  below the fold, which technically fails the "display a single cube" spirit.
- Centring the title over the tabs → tabs jump when you rename the project.
  Anchor tabs to the right edge instead.
- Text on the header inheriting `user-select` during a drag → you select copy
  instead of orbiting the camera. Disable selection in the bar.
- Using the header area for the FPS counter in Project 0 → tempting, but later
  levels need that space for resolution and level controls.

---

## 7. Acceptance checklist for Project 0

- [ ] Header shows title, your name, and an info space — all visible at 1280×720.
- [ ] A single cube, 2×2×2, fully inside the frame and not clipped at the edges.
- [ ] Canvas fills the space below the header, no page scrollbars.
- [ ] Header still legible and unwrapped at ~380 px width.
- [ ] No console errors on load; page still renders after a window resize.
- [ ] Nothing in the header runs inside the render loop.

Note on the 2×2×2 requirement: the cube you already have is a unit cube with
its base sitting at `y = 0`. "2×2×2" means a uniform scale of 2 and half the
footprint moved back to stay centred on the origin — worth stating in the
About panel so the grader sees you checked the dimension rather than eyeballed it.
