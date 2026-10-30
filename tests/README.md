# Browser checks

Playwright scripts that drive the web app in headless Chromium with a fake camera
(`--use-fake-device-for-media-stream`) and mocked Supabase, Replicate and MediaPipe hosts.
They are browser simulations, not real-device tests.

- `t1.js`: onboarding, camera, capture, review, Edit photo
- `t2.js`: editor flow, on-device preview and Apply, AI Apply, Run again, undo/redo, compare,
  2-credit style, zero credits, paywall, save with a pending preview, back, refresh and resume
- `t3.js`: 320×568, desktop light mode, keyboard, camera denied, AI failures, 125% text
- `t4.js`: every on-device tool kind, magic-erase brush and its charge

`harness.js` expects the MediaPipe package and model files at the paths at its top; adjust them for your machine.
