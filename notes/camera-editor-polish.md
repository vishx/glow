# Glow: Camera + Editor polish and the free sample

Branch `redesign/camera-editor`. This builds on the redesign and the readiness pass in
`notes/readiness-and-sample.md`, which is still accurate for camera saving, export quality and AI
job recovery.

Everything below is on the branch only. The live site still runs the previous push of this branch
(commit `ef32ac0`, deployed 2026-10-30 with the owner's OK). It has the sample with on-device
tools only, and none of the changes listed here.

## 1. What changed

### Free sample (Priority 1)

- **Prepared AI previews.** There are now six, made once with Glow's real AI pipeline and shipped
  as static files in `public/samples/demo/`:
  - Retouch (CodeFormer)
  - Enhance, Relight, Golden hour and Sleek bob (nano-banana)
  - 3D Toon (face-to-many)

  `manifest.json` records, for each one:
  - the tool id and name
  - the original and result files
  - the exact settings and the model
  - the Replicate prediction id and time
  - the size, whether it lines up with the original, SHA-256 and `assetVersion`

  It contains no URLs or tokens. See `public/samples/demo/SOURCE.md` and section 3.
- **Entry points.**
  - The Editor landing has a "Try a sample · Free" card with the portrait.
  - The last onboarding screen has "Try a sample".
  - Coming back to the sample never repeats onboarding.
- **Demo behavior** (mostly kept from the earlier sample work):
  - One effect at a time; every prepared preview starts from the untouched original.
  - On-device tools stay interactive and reset to the original first.
  - No AI request, no credits, no sign-in and no paywall.
  - A missing file shows a message and Retry.
  - "Try your own photo" leaves the demo only when a photo is actually picked.
- **New in this pass:**
  - "Sample previews show one effect at a time" sits in the For You row.
  - "Demo · No credits used" and "AI-generated sample" are in the demo bar, and an
    "AI-generated sample" tag is on the photo.
  - A result the model reframed says that Compare won't line up exactly.
  - Saving names the file `glow-ai-sample-prepared-preview-<tool>-…`, and the save prompt calls it
    a prepared preview.

### Onboarding (Priority 2)

- **Three screens**, each with the portrait taking about 46% of the screen height:
  - Screen 1: Camera and Editor are introduced.
  - Screen 2: a real before/after. It uses the first prepared preview that lines up (Retouch), or
    the free Glow filter made on the device if none is shipped.
  - Screen 3: Open camera, Choose a photo, Try a sample.
- **Headlines and copy** are exactly as specified. "Skin texture stays real" is gone.
- **Controls.** Back on screens 2 and 3, Skip, and step dots (announced as "Step n of 3").
- **No permission is asked during onboarding.** The camera asks when it opens.

### Editor (Priority 3)

- **Canvas.**
  - Charcoal `#18171B` in both themes, with 16px corners.
  - The whole photo is shown (contain).
  - Checkerboard only behind pictures with real transparency.
  - The canvas is never part of the export.
- **Comparison.**
  - Opens on Edited.
  - Original / Compare / Edited is a 44px segmented control under the photo, disabled until
    there is an edit or a preview.
  - The divider shows only in Compare: 2px line, 26px knob in a 44px target, 75% down.
  - Labels on the photo, and arrow keys move it.
  - Both images sit in a frame sized to the picture, so they stay aligned through any resize.
- **Stable layout.**
  - The view bar, demo bar, tabs, one fixed-height row for subgroup chips / search / note, and a
    fixed-height tool row are the same height in every category.
  - Tests measure the photo box across all five tabs and every subgroup at 390×844, 320×640 and
    412×915.
  - When a tool is open on a phone, the tabs and the chip row step aside.
- **All.**
  - Search, plus an expand button that switches to a taller, vertically scrolling catalog with
    group headings. It is collapsed again when a tool is picked.
  - On desktop the catalog simply scrolls.
- **Tools.**
  - 24px outline icons, 48px wells, 80px tools, 13px labels on up to two lines.
  - The selected state is a 2px ring, a bold label and a check mark.
  - Cost badges have room above the row, and the last tool scrolls fully into view.
- **Credits.**
  - A "3 AI credits" chip under the photo shows the real balance, opens the existing details
    sheet, and is 44px tall.
  - Undo and Redo sit on the photo's bottom-right corner.

### Camera and navigation (Priority 4)

- Unchanged from the readiness pass.
- An explicit choice in onboarding (camera, pick a photo or the sample) now overrides the startup
  preference. Skip still follows it.

### Visual system (Priority 5)

- Tokens were already as specified; no emoji were added.

### Real-photo editing (Priority 6)

- Unchanged: full-size export, AI job recovery, server-side credit checks, undo without charges.
- The existing tests for these still pass (section 4).

## 2. Screenshots and recording

These live in `notes/shots/polish/`. They are mocked-browser renders (fake camera, mocked
servers), not device captures.

- **Screens.** Every screen in dark 390×844, light 390×844, dark 320×640, light 412×915 and dark
  1440×900:
  - `onboarding-1/2/3`
  - `editor-landing`
  - `sample` (opened)
  - `sample-tool` (prepared preview open)
  - `sample-compare`
  - `all`
  - `all-search`
  - `camera`

  The camera shows Chromium's fake video stream.
- **Recording.** `sample-flow.webm` covers Editor home, Try a sample, all six prepared previews,
  Compare dragged twice, and a free on-device tool.
- **Network evidence.** `sample-flow-network.json` has every request made while the sample was
  open, at a zero credit balance.

## 3. Prepared previews: what exists

| Preview | Status | Model | Size | Lines up with the original |
| --- | --- | --- | --- | --- |
| Retouch | ready | sczhou/codeformer | 1122 × 1402 | yes |
| Enhance | ready | google/nano-banana | 896 × 1152 | close (the model returns 7:9) |
| Relight | ready | google/nano-banana | 896 × 1152 | close |
| Golden hour | ready | google/nano-banana | 896 × 1152 | no, reframed by the model |
| Sleek bob | ready | google/nano-banana | 896 × 1152 | no, reframed by the model |
| 3D Toon | ready | fofr/face-to-many | 1122 × 1402 | yes (a new picture by design) |

Nothing is missing.

**How they were made.** The owner approved one paid run.

- `tools/demo/generate.ts` ran once in a GitHub Actions job on the `demo-gen` branch.
- It reached Replicate through a temporary Supabase function, `demo-gen`, which only accepted
  that job's GitHub OIDC token and only the sample's four models. No shared secret existed, and
  the Replicate token stayed in Supabase.
- The function was replaced with a stub that answers 410 right after the run. It can be deleted
  in the Supabase dashboard.

**Cost.** It was not verified from the Replicate bill.

- The first attempt made Retouch and was then throttled. The second made all six.
- That is seven predictions in all: two CodeFormer, four nano-banana and one face-to-many.
- At list prices this should be well under $1.

## 4. Tests

`npm test`: 41 mocked checks, all in headless Chromium with a fake camera and mocked Supabase and
enhance. They prove the app's logic in a browser, not behavior on phones or against live servers.

New checks:

- **Onboarding.**
  - Copy, Back and Skip.
  - Photo share, and type sizes of 28–34px and 15–16px.
  - No camera request.
  - The prepared or free before/after on screen 2.
  - Try a sample at the end.
- **Layout.**
  - The photo box is identical across all categories and subgroups at three phone sizes, for a
    photo and for the sample.
  - The canvas color in both themes; contain.
  - Edited first, and comparison disabled until an edit.
  - Handle size and position, and the segments' size and place.
  - Keyboard on the divider.
  - The saved file is the photo's own size.
  - Checkerboard only for transparency.
  - The credit chip, its sheet and its 44px target.
  - All: search, expand and collapse, last tool fully visible, cost badges not clipped.
- **Demo.**
  - All six shipped previews match the manifest (file, size, hash, provenance), each shows alone,
    and none makes an AI request at a zero balance.
  - Canceling "Try your own photo" keeps the demo.
  - Reduced motion turns the crossfade off.

## 5. Release blockers and follow-ups

1. **Replicate rate limit.**
   - The run hit Replicate's limit for accounts with under $5 of credit: 6 new predictions a
     minute, one at a time.
   - Real users on the live app would hit the same limit as soon as two people use AI tools at
     once. Each throttled edit fails. The server code returns the credit when an edit can't
     start, but that path wasn't tested against the live function.
   - Add at least $5 of Replicate credit before launch.
2. **The sample portrait's source** (generator and its terms) still needs to be written into
   `SOURCE.md`.
3. **Branch only.**
   - None of this is deployed.
   - The backend patch (migration 006 and the new enhance) is also still undeployed.
4. **No real-device testing.** That covers iPhone and Android camera, saving to Photos, TalkBack
   and VoiceOver.
5. **Cleanup.**
   - Delete the `demo-gen` Supabase function (now a stub) and the `demo-gen` branch when
     convenient.
   - `tools/demo/generate.ts` and `pipeline.ts` on this branch can remake the previews.
