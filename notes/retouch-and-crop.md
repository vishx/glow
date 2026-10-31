# Glow: reshape fixes and interactive crop

Branch `redesign/camera-editor`. Nothing here is deployed.

## 1. Face shape, Nose and Eye size

### What was wrong

The old tools moved pixels with a handful of separate "push" and "bulge" strokes.

- Each stroke worked inside its own square box and was applied one after another.
- At high strength, the boxes' edges showed as straight seams along the cheeks and jaw.
- Overlapping strokes pulled against each other, which made the dents and pinches.
- Nose pushed each wing 35% of the way to the nose tip, which squashed it.
- Eye size magnified up to 1.39× in a circle wide enough to drag the lids and brow area.

The 0–100 range wasn't the root cause. The sheets in `notes/shots/retouch/` show the old warps at
100 next to the new ones: `retouch-*.jpg`, and `before-after-*.jpg` for each tool.

### What it does now (`public/engine.js`)

Each tool builds one smooth displacement field per face and moves every pixel once (`fieldWarp`).

- **Face shape**
  - Narrows the lower cheeks and jaw toward the face's centre line.
  - It is strongest along the jaw and lighter at the chin. Nothing moves at the cheekbones, and
    it fades out below the chin.
  - Each side follows its own face outline from the landmarks, so tilted and turned faces work.
- **Nose**
  - Narrows the nostril wings toward the nose's own centre line, with a lighter touch up the
    bridge.
  - It fades out before the inner eye corners, the cheeks and the upper lip.
- **Eye size**
  - A gentle magnify inside an oval that follows the eye's tilt.
  - The oval stops short of the brow and fades to nothing at its edge.

**Strength at 100.** The slider maps linearly onto these ranges:

| Tool | At 100 |
| --- | --- |
| Face shape | 10% narrower at the jaw |
| Nose | 20% narrower at the wings |
| Eye size | 1.15× at the eye's centre |

Checked on every test portrait:

- **No folds.** The smallest Jacobian determinant of each field is 0.70 to 0.79, where anything
  above 0 means pixels can't cross, double up or leave holes.
- **No seams.** The fields are exactly zero at the edge of their area, and not one pixel outside
  that area changes (`notes/shots/retouch/metrics.json`).

**Baseline and combining.**

- 0 returns the input unchanged. The app treats it as "nothing to preview", and Apply stays off.
- Every preview is made from the committed photo with the current slider value, never from the
  previous preview. Setting 100, then 40, then 100 gives the identical picture (tested).
- Each Apply is its own undo step. The landmarks are found again on the result, so the tools
  stack cleanly.
- Landmarks are cached per picture, so moving the slider doesn't search for the face again.

**Unavailable state.** When a tool opens, Glow checks the face first. A reshape tool shows a note
in its panel and turns off its slider and Apply, instead of guessing, when:

- no face is found,
- the face is too small (narrower than 70px or 6% of the picture),
- more than two outline points fall outside the photo, or
- the head is turned too far to the side (one cheek under 35% of the other, from the nose tip).

Other faces in the same photo that pass are still reshaped.

All of this runs on the device and makes no requests. The tests check that no AI request is made
and no credit is used.

## 2. Crop and rotate (`public/app.js`, `#cropView` in `index.html`)

**The surface**

- The photo moves under a fixed frame.
- The frame has a rule-of-thirds grid and corner and edge handles (44px targets), and the area
  outside it is dimmed.
- The hint "Drag to reposition · Pinch to zoom" fades after the first touch or 5 seconds.

**Gestures**

- One finger or the mouse drags the photo.
- Two fingers pinch-zoom. The photo point under the fingers' midpoint stays under it, and the
  photo follows the midpoint as it moves.
- The mouse wheel or a trackpad pinch zooms around the cursor.
- The keyboard works too: arrow keys move the photo, and + and − zoom.
- `touch-action: none` and the wheel handler stop page scroll only on the crop surface.

**Panel**

- Shapes: Free, Original, Square, 4:5, 3:4, 9:16 and 16:9.
- A Zoom slider from 1.0× to 8.0×, which stays in sync with pinch and the wheel.
- Rotate 90° and Reset.
- Apply is off until the framing changes.

**Limits**

- The crop always stays inside the photo, so there are never blank edges, and zoom can't go
  below the photo filling the frame.
- With a fixed shape, handles keep the shape exactly. A corner keeps the opposite corner still;
  an edge keeps the frame centred the other way.
- Free handles move only their own edges.
- When a handle is released, the frame grows back to fill the canvas, showing the same area
  larger.

**Rotate**

- Rotate turns the photo a quarter turn clockwise.
- The bounds, drag limits and crop coordinates are all recomputed. In Free and Square the crop
  turns with the photo.
- A chosen shape such as 4:5 or 9:16 stays that shape and is re-fitted around the same spot.

**Editing behavior**

- Crop works on the current edited photo.
- Cancel closes it without changing anything.
- Apply adds one undo step. Undo and Redo restore the right picture.
- **Saving.** Apply stores the crop as fractions of the rotated photo, plus the exact shape, so
  Save cuts the same area from the full-size original (`cropRect`).
- **Re-opening.** Opening Crop right after a crop shows the uncropped photo with that framing, so
  the crop can be widened again. Applying then replaces the earlier crop, built from the
  uncropped photo, instead of cropping twice. Save replays it the same way.
- **Older drafts.** Steps saved by the old ratio buttons still replay through `cropRotate`.

## 3. Verification (mocked headless Chromium, not real phones)

`npm test`: 47 checks, 6 of them new.

- **Retouch**
  - 0 is untouched and Apply is off.
  - The same value always gives the same picture, so previews come from the baseline.
  - Face shape, Nose and Eye size at 100 combine.
  - Undo and Redo work, and saving keeps the photo size.
  - No AI request and no credit used.
  - A photo without a usable face shows the unavailable note, with the slider and Apply off.
- **Crop surface**
  - The hint, grid, dimming, handles and shapes are all present.
  - The slider zooms around the centre.
  - A drag moves the crop by exactly the drag distance and stops at the photo edge.
  - The wheel keeps the point under the cursor fixed.
  - A real two-finger pinch (through Chrome's touch input) zooms by the finger spread and stays
    anchored at the midpoint.
  - The frame is always covered, and the page doesn't scroll.
- **Shapes and handles**
  - Every shape is exact.
  - With 4:5 locked, it stays 4:5 while dragging corners and edges.
  - A Free edge changes only its own side.
  - Corners stop at the photo.
  - Rotate swaps the bounds and moves the crop correctly; 9:16 survives a turn; Reset works.
- **Apply and Save**
  - Cancel restores the photo.
  - Apply equals the framed area on screen, within 0.3%.
  - The edge pixels of a coordinate-coded image come from exactly the frame's edges.
  - There is one undo step, and Undo and Redo work.
  - Re-opening keeps the framing, and Apply rebuilds from the uncropped photo.
  - The saved file is the same size as the preview, with a mean pixel difference under 1.5/255.
  - No AI request is made.
- **12 MP photo:** 9:16 at 2× zoom, rotated, saves from the full-size original at an exact 9:16.

**Visual review.**

- `node tests/retouch.js` renders the sheets and `metrics.json` in `notes/shots/retouch/`.
- `node tests/crop-shots.js` renders `notes/shots/crop/` in dark and light at 390×844, and dark at
  1440×900.

## 4. Limitations

- **Only one real face was tested.** The only portrait available is the owner's AI sample.
  Different face shapes and angles were simulated with variants of it: mirrored, tilted 12°,
  stretched 1.2×, squeezed 0.85×, small in a large frame, and cut off. These are not different
  people. Strongly turned or profile faces, glasses, beards and group photos weren't tested on
  real pictures.
- **No real devices.** Pinch was tested with Chrome's synthetic touch input, not on a phone.
- **Conservative maximums.** The strength at 100 is deliberately gentle. It is easy to raise in
  `RESHAPE_MAX` if the owner wants a stronger maximum.
- **Body reshape** tools still use the old push warps; they weren't part of this request.
