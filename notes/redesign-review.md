# Glow redesign: Camera + Editor

Branch `redesign/camera-editor`, commit `78eed42` on top of baseline `3b1f614`.
Nothing was deployed, published or changed in billing or Supabase.

## What I found first

- **Stack.** A plain HTML/CSS/JS PWA in `public/` on Vercel. The backend is Supabase edge functions (`enhance`, `account`, `revenuecat-webhook`, `admob-ssv`), with Replicate for AI. `mobile/` is a Capacitor 8 wrapper that copies `public/`. There is no framework, router, test suite or CI. I kept the stack.
- **On-device tools.** Face and makeup (MediaPipe face landmarker), body (pose), hair color (hair segmenter), backgrounds (selfie segmenter), filters, the WebGL beauty camera and My Look.
- **Server tools.** Enhance, Restore, Face repair, Retouch, Smile, Relight, Golden hour, Upscale, Colorize, hairstyles, outfits and try-on, styles, Magic erase and Expand.
- **Credits.** The server enforces them through `consume_ai_edit`:
  - free users get 3 a day, resetting at UTC midnight;
  - Pro users get 40 per rolling 7 days;
  - headshot, anime, watercolor and fashion cost 2;
  - a failed or canceled prediction is refunded when the server sees it.

## What changed

- **Design system** (`styles.css`)
  - The soft luxury tokens for dark and light, with a System, Dark or Light setting.
  - Spacing, radius, motion and type tokens in rem, so enlarged text scales.
  - Shared buttons, chips, sheets and tool tiles.
  - Icons are regenerated from Lucide 0.460 at 1.75 stroke (`icons.js`, ISC notice in `licenses.txt`), plus the custom face and makeup icons. There is no emoji in the UI.
- **Structure**
  - `platform.js` wraps camera, photo picking, saving, haptics and the resumable draft (IndexedDB), so native versions can be swapped in later.
  - `engine.js` holds all pixel code, moved unchanged apart from these additions:
    - a 2048px working size;
    - new Light, Color, Warmth and Detail adjustments;
    - Crop and rotate.
  - `app.js` is the UI.
- **Navigation**
  - Bottom navigation with Camera and Editor appears on both landing screens and is hidden while editing or reviewing a shot.
  - The first launch shows three skippable intro screens, then opens Camera.
  - Later launches open the last-used destination, or whatever Settings → "Open Glow in" says.
  - Import or gallery actions always open Editor.
- **Camera**
  - **Layout.** The viewfinder shows the whole frame, so what you see is what you capture, mirroring included. Below it are the looks (Original, Natural, Soft Glam, Glam and saved looks) and one Adjust control with the real sliders and filters. The capture row has the gallery on the left, a 72/88px shutter in the middle, and flip on the right.
  - **Flash** shows only when the camera reports a torch.
  - **Error and permission states** each have a recovery action: permission prompt, denied, busy, no camera, and no live-camera support (which falls back to the device camera).
  - **Without WebGL,** capture still works and a note says where looks can be added afterwards.
  - **After capture** you get Retake, Edit photo and Save. Save original is a setting. Edit photo opens the raw original with the look as one undoable step.
- **Editor**
  - **Landing.** Choose a photo, Try a sample, and Continue editing when a session exists. That session survives a refresh, and Discard asks before deleting it.
  - **Active editor.**
    - Back, Save, the canvas, and a 2px divider with a 44px keyboard-operable handle.
    - An Original, Compare and Edited toggle.
    - Undo and redo (up to 20 steps), plus the AI balance.
  - **Categories.** For You, Retouch (Face, Skin, Makeup, Hair, Body), Looks (Filters, Styles, Outfits), Edit (Crop, Light, Color, Detail, Background) and All. All has search across the original eight categories. Every old tool is still there.
  - **For You** shows favorites (the star in the tool panel), recent tools, and four fixed starting points labelled as such. It never suggests reshaping.
  - **Tool panel.** It shows the name, the cost or "Free · on-device", a hint, controls, Cancel, and Apply.
  - **Applying.**
    - On-device tools preview first, and Apply commits the preview.
    - AI tools charge once, on Apply, and the result is committed straight away.
    - Undo and redo reuse stored results.
    - Reapplying the same AI tool says "Run again · 1 credit" before it charges.
  - **Saving.** Save exports the committed photo. If a preview is pending, Glow asks whether to apply it, save without it, or keep editing.
  - **Reshaping** tools start at 0.
- **Credits shown**
  - The balance line reads "2 AI credits left today" or "… this week", and tool badges read "AI · 1" or "AI · 2".
  - The panel shows your balance, and Apply shows the cost.
  - At zero, AI tools show "Get more AI credits". Free tools, capture and saving still work.
  - The credits sheet explains the reset: UTC midnight in local time with a countdown for free users, and the rolling 7 days for Pro.
  - After a failure Glow re-reads the balance and states only what the server shows, such as "No AI credit was used."
- **Paywall**
  - Close button, "More room to create" and "Glow Pro · 40 AI credits each week".
  - The perks no longer imply that free users can't use AI tools.
  - Radio plan cards with store prices from RevenueCat, and a button that names the selected plan.
  - Renewal text for that plan, Restore, Terms and Privacy.
  - The rewarded ad appears only when credits are low.
- **Other**
  - An app icon concept in `brand/`, also used for the PWA icons: warm charcoal, a blush camera outline and a four-point glint, with no lettering.
  - An illustrated sample photo.
  - The service worker cache now covers the new files.
  - The privacy policy is updated for the draft storage and the new adjustments.

## Deliberate behavior changes to review

1. **Camera Auto fix is gone.** It used to send every capture to Enhance and charge a credit automatically, which conflicts with "basic capture is free, no credit gate". Enhance is now one tap away in Editor → For You.
2. **The camera no longer auto-saves on capture.** It used to save the original and the result to the Glow album automatically on the phone. Now you tap Save, with an optional "Also save the original" setting.
3. **Imports are now 2048px instead of 1280px,** for export quality. AI uploads are still shrunk to 1600px, and the erase mask is drawn at the upload size.
4. **The Natural look is lighter** (smooth 25 instead of 35) to keep skin texture. "No beauty" is now "Original".

## Checks run (browser simulation, not a real device)

These used Playwright with Chromium, a fake camera, and mocked Supabase, Replicate and MediaPipe hosts. The scripts are in `tests/`. All passed, with no page errors.

- **Phone flows (390×844):**
  - onboarding → camera → capture → review → Edit photo;
  - pick photo → preview → Apply;
  - AI Apply charges once, and Run again is disclosed;
  - undo and redo make no new server calls;
  - Compare views work, and the handle responds to arrow keys;
  - a 2-credit style works, and zero credits opens the paywall without calling the server;
  - a filter works at zero credits;
  - Save with a pending preview asks first, then downloads;
  - Back shows Continue editing, and a reload restores the session;
  - all on-device tool kinds produce a preview, and the erase brush charges 1.
- **Layout:**
  - 320×568 has no horizontal scroll, and the panel hides tabs to give the photo room;
  - a 1280×800 desktop in light mode puts the photo on the left and tools on the right;
  - keyboard tab navigation works;
  - text at 125% has no horizontal scroll.
- **Camera denied:** shows the recovery card.
- **AI failures:**
  - a failure at start reports "No AI credit was used";
  - a failure while running is refunded by the mock server, and the app reports the same.
- **Contrast:** text pairs are 5.2:1 or better in both themes. Borders (#3D343F on #121014, 1.6:1) are decorative only. Every selected state uses an accent outline or fill plus `aria-pressed`.

## Not verified, and limits

- Real iPhone or Android camera behavior is untested: orientation, torch, both cameras, Capacitor saving and haptics. The fake camera is landscape. This needs a device pass.
- Real Replicate and RevenueCat calls are untested; they were mocked.
- **Server mismatches to know about (not changed):**
  - The free reset is UTC midnight, not local midnight, and the app now says so.
  - Pro's 40 credits are a rolling 7 days, not a weekly reset.
  - If the app gives up after 3 minutes, the server keeps the job and the credit is not refunded unless a later poll sees a failure. The app doesn't claim a refund in that case.
  - There is no server endpoint to cancel a running AI job, so the UI offers no cancel during AI edits.
- **Undo history** keeps only the original and the latest result after a reload.
- **Haptics** use the Capacitor Haptics plugin only if it's installed (it isn't yet), otherwise `navigator.vibrate`.
- **Sample photo.** It's an illustration, so the face tools have nothing to find on it. Swap in a licensed portrait at `public/samples/sample.jpg`.
- **Wordmark.** It keeps Cormorant as a logo treatment. Headlines use Cormorant only on the onboarding screens.
