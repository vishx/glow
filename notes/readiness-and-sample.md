# Glow: readiness pass and free sample demo

Branch `redesign/camera-editor`. This covers the commits after `b248ccb`. Nothing was deployed,
published, or changed in billing, Supabase or Vercel.

| Commit | What |
|---|---|
| `3f669db` | Readiness: full-size export, camera auto-save, AI job recovery, accessibility, `npm test` |
| `5cd4c06` | Backend change for AI job recovery, **prepared only, not deployed** |
| `cf92cc6` | Free sample demo with prepared AI previews; the AI pipeline shared with the generator |

Screenshots are in `notes/shots/`. The files whose names end in `-TESTASSET` show the demo with
test stand-in results, which are tone changes, not Glow output.

## 1. Camera saving

- **Settings → Automatically save captures** (off by default).
  - **Off:** after each shot you get Save, Retake and Edit photo.
  - **On:** each shot is saved as soon as it's taken. The review screen still offers Edit photo and
    Retake, and Save shows "Saved".
  - The help text below the switch depends on the platform. In the phone app, photos go to the
    Glow album. In a browser, each shot is downloaded, because browsers can't write to the photo
    library.
- **No duplicates.**
  - Auto-save and the Save button share one save path and one in-flight promise.
  - Tapping Save again, or Save after auto-save, adds nothing.
  - If you open Edit photo while a save is still running, the editor learns when it finishes.
- **Also save the original**
  - It saves the untouched full-size frame, and only when a look changed the photo. With the
    Original look, only one file is saved.
  - It saves the original once per photo. Later editor saves skip it.
  - In the editor it saves the picked file byte for byte, with its own size and EXIF.
- **Honest messages.** Success is shown only after the platform call resolves, and the wording
  matches what happened:
  - "saved to your Glow album" (phone app, Media plugin);
  - "Sent to the share sheet. Choose Save Image there…";
  - "Download started. Your browser keeps it in Downloads."

## 2. Originals and export quality

- 2048px is now only the working size for previews; it no longer reduces the saved photo.
- The picked or captured file is kept as the original.
- Every on-device step is stored as a recipe. Save replays the recipes on the full-size original
  in `renderExport()`.
- Limits:
  - Saves are capped at 16 MP and 8192px on the long side, under iOS's canvas limit.
  - An AI step's result is used at the size the model returned. Nothing is upscaled.
- The beauty shader runs in 2048px tiles with matching seams, and face detection runs on a
  2048px copy, so large photos don't need huge GPU textures.
- If the full-size render fails (for example, the device runs out of memory), Glow asks before
  saving the preview size and says so in the message.
- PNG transparency is kept, and mirrored selfies stay as previewed.

Measured dimensions (mocked browser, from `tests/out/results.json`):

| Case | Original | Working copy | Saved |
|---|---|---|---|
| 12 MP phone JPEG, EXIF orientation 6, Light +20 then Crop Square | 3024 × 4032 (displayed upright) | 1536 × 2048 | 3024 × 3024 |
| 24 MP JPEG, Film filter | 6000 × 4000 | 2048 × 1365 | 4899 × 3266 (16 MP cap) |
| 12 MP photo, Enhance (AI) then Light −10 | 3024 × 4032 | 1024 × 1365 (AI result) | 1024 × 1365 (the AI result's size, not upscaled) |
| Transparent PNG, My Look | 1200 × 900 | 1200 × 900 | 1200 × 900 PNG, corners still transparent |

The save message states the size and why, for example "Saved at 1024 × 1365, the size Enhance
returned."

## 3. AI job recovery

- **What the app keeps.** Each AI edit saves on the device:
  - its own request id and, once known, the job id;
  - the tool, the session and the step it was based on.
- **Status names.** The edit bar (`#jobBar`) uses four:
  - **processing**;
  - **status unknown**, when there was no answer, the page reloaded mid-request, or the
    network dropped;
  - **failed**, when the server confirmed it;
  - **ready**.
- **Check status** and the automatic resumes never send a new paid request. Resumes happen on
  reload, on return from the background and when the connection comes back. There is never an
  automatic paid retry. Glow also runs only one AI edit at a time, so nothing is charged twice.
- **Refunds.** "Glow's server returned the AI credit" appears only when the server says
  `refunded: true`. Otherwise Glow shows the current balance.
- **Where a late result goes**
  - Back into its session if nothing changed there.
  - If you kept editing, it waits in the bar under "Use it".
  - If you started another photo, it waits on Editor home as "Your … result is ready", with Open
    and Discard.
- **Prepared backend change (`5cd4c06`, not deployed).** It needs migration 006 and a redeploy
  of `enhance`.
  - The request id makes a resent request return the same edit instead of charging again.
  - `GET ?request=` finds an edit whose job id never arrived. A 404 means it never started.
  - Every answer carries `refunded`.
- **Against today's deployed server:**
  - "Check status" for an edit with no job id says the server can't look it up yet.
  - The app never claims a refund, because the server doesn't report one.

## 4. Try a sample (free demo)

- **The original.** `public/samples/demo/original.png` is your AI-generated portrait, byte for
  byte (1122 × 1402). Its source is recorded in `public/samples/demo/SOURCE.md`.
- **Labels and exit.** The editor shows "Demo · No credits used", "AI-generated sample" and
  **Try your own photo**. The credit balance is hidden.
- **Prepared AI previews**
  - They come from `samples/demo/manifest.json` and load as static files.
  - Each one starts from the original, so switching replaces the preview instead of stacking.
    Before/after compares the original with the selected result.
  - The badge reads "Prepared preview", and the panel says "Sample previews show one effect at a
    time." There are no sliders or variants.
  - A file that is missing at open isn't offered. One that fails to load shows a message and a
    Retry button.
  - The first two previews are preloaded.
- **Zero cost**
  - Demo tools make no enhance request at all, so credits are never consumed, reserved or
    refunded.
  - The demo works with zero credits and with sign-in failing, and never opens the paywall.
  - `startAiEdit` refuses to run in the demo, and the server still enforces credits on every
    real request.
- **On-device tools** stay interactive. Picking one while a prepared preview is showing resets to
  the original and says so, and local edits are never sent to AI.
- **Try your own photo** leaves the demo completely:
  - labels and demo state are cleared;
  - face and adjustment settings changed in the demo are restored;
  - real prices come back, and nothing is selected or auto-run;
  - the sample is never kept as a draft.
- **Saving the sample** asks first ("Save the AI-generated sample?") and names the file
  `glow-ai-sample-…`.
- **Offline.** The service worker (now `glow-v3`) caches the sample as it's fetched. Nothing
  claims offline availability.

### Prepared previews available now: none

The container can't reach Replicate, and generating needs paid runs, so I didn't make any and
didn't substitute other images. Until they exist, the demo offers the free on-device tools and
says "AI previews for the sample aren't ready yet." Each one needs one run. The models and
settings are the ones in `supabase/functions/enhance/pipeline.ts`, the same code the live
function uses.

| Tool id | Tool | Model (first that exists) | Settings | Approx. cost per run* |
|---|---|---|---|---|
| `retouch` | Retouch (skin; the AI side of blemish removal) | sczhou/codeformer | fidelity 0.3, face_upsample, upscale 1 | ~$0.01 |
| `pro` | Enhance | google/nano-banana → flux-kontext-pro | `MODES.pro` prompt | ~$0.04 |
| `relight` | Relight | google/nano-banana → flux-kontext-pro | `MODES.relight` prompt | ~$0.04 |
| `golden` | Golden hour | google/nano-banana → flux-kontext-pro | `MODES.golden` prompt | ~$0.04 |
| `hair_bob` | Sleek bob (hairstyle) | google/nano-banana → flux-kontext-pro | `hair("a sleek chin-length bob")` | ~$0.04 |
| `toon3d` | 3D Toon (creative style) | fofr/face-to-many | style 3D, prompt "a person" | ~$0.02–0.05 |

\*These are rough figures, not checked against Replicate's current price pages, which this
container can't open. In total it's well under $1 even with a retry or two. To make them, with
the owner's go-ahead:

```
REPLICATE_API_TOKEN=… deno run --allow-env --allow-net --allow-read --allow-write tools/demo/generate.ts
python3 tools/demo/optimize.py
```

- The token comes only from the environment.
- The scripts record the model, version and prediction id, never URLs.
- They fit results to the original's frame when the aspect ratio matches. 3D Toon redraws the
  picture, so its framing may not line up.

## 5. Accessibility

- A `--control` token outlines anything pressable: buttons, sliders, switches, the search field,
  segmented controls and plan cards. It has at least 3:1 contrast on every surface in both
  themes:

  | Theme | On background | On surface | On raised surface |
  |---|---|---|---|
  | Dark | 4.42 | 3.96 | 3.54 |
  | Light | 4.25 | 4.51 | 3.92 |

- Inactive controls stay at 50% opacity.
- Sliders and switches are custom-styled with a visible focus ring.
- Sliders are named after their tool, for example "Light amount", with spoken values such as
  "Plus 12" or "50 percent".
- The job bar is a status region, and previews and results are announced.
- **At 200% text:**
  - Camera, Editor home, the editor with a tool open, and Settings have no sideways scroll.
  - Apply stays reachable.
  - At 320 × 720 the demo bar compacts while a tool is open.

## 6. Camera lifecycle

- Each start carries a generation token, so only the newest start keeps its stream.
- The camera stops on leaving the screen, on backgrounding, on `pagehide` and while reviewing a
  shot. It resumes exactly once.
- A permission change made while Glow is open switches between the denied card and the live
  camera.

## 7. Test results

**Mocked browser, `npm test`: 29 of 29 pass.**

- Headless Chromium with a fake camera, a fake enhance and account server, and local MediaPipe.
- Coverage:
  - camera save and auto-save, and the camera lifecycle;
  - export sizes, EXIF, PNG alpha and original-once;
  - AI recovery against both the current and the patched server behavior;
  - 200% text, focus, slider names and contrast;
  - 10 demo checks.
- The demo checks use a test manifest with stand-in images.
- Run with `npm run test:setup` once, then `npm test`.

**Real integration: none.** Replicate, the deployed Supabase functions, RevenueCat and the
prepared backend patch have not been exercised for real. `deno check` shows no new type errors
from the pipeline refactor. Its 14 pre-existing `quota is unknown` warnings are unchanged.

**Real device: none.** No phone or real camera was available. Use this checklist on one iPhone
and one Android phone, in both the app build and a browser:

1. **Camera permission**
   - First launch: allow. Deny, and check the recovery card.
   - Change the permission in Settings while Glow is open, and when coming back.
2. **Front and rear cameras**
   - Flip quickly several times. Only one camera light should stay on.
3. **Rotation and framing**
   - Portrait and landscape.
   - The preview matches the saved photo, and the selfie is mirrored as it was shown.
4. **Torch** shows only on cameras that have one, and switches on and off.
5. **Repeated capture**
   - Take 10 shots with auto-save off, then on.
   - One file per shot, two with Also save original, none duplicated.
   - In the app, check the Glow album.
6. **Background and resume** during the live camera and during review. The camera light goes
   off, and comes back once.
7. **Saving in the app** (Media plugin): the message appears only after the photo is in the
   album. Saving with photo access denied shows the error.
8. **Capture → Edit photo → a face tool and a filter → Save:** the saved size equals the camera
   frame.
9. **A 12 MP or larger library photo**
   - Several edits, then Save.
   - Check the size, the orientation, the time taken and that nothing crashes. Try an older
     phone too.
10. **AI recovery** (needs the backend patch for the last part)
    - Start Enhance, then go to airplane mode, then Check status.
    - Background the app mid-edit and come back.
    - Kill the app mid-edit and reopen it.
11. **Try a sample** on a slow connection: the original appears first, and previews load on
    tap. Test with zero credits.

## 8. Release blockers

1. **Sample previews.** The six AI previews need one paid generation run, which needs your
   go-ahead. Also record which generator made the sample portrait, and its terms, in
   `SOURCE.md`.
2. **Backend recovery patch.** Run migration 006 in the SQL editor, then deploy `enhance` from
   this branch. `pipeline.ts` must deploy with it. Until then, Check status can't find an edit
   whose job id never arrived.
3. **Real-device pass** using the checklist above. None of the above has been verified on a
   device.
4. **Real integration pass:** a real Enhance, a forced failure that shows the refund, and a
   RevenueCat purchase on test accounts.
5. **Existing owner steps** from earlier work:
   - RevenueCat public keys;
   - real AdMob unit ids;
   - the support email;
   - store developer accounts.
6. **Haptics.** The Capacitor Haptics plugin is still not installed (it falls back to vibrate).
