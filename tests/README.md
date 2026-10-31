# Browser checks

`npm run test:setup` once (MediaPipe library and models), then `npm test`.
`npm test -- export` runs only the checks whose names contain "export".

Every check is a **mocked browser simulation**: headless Chromium with a fake camera
(`--use-fake-device-for-media-stream`), a fake enhance/account server, and local copies of the
MediaPipe models. A pass proves the app's own logic in a browser. It is not evidence about real
phones, real cameras, Replicate, RevenueCat or the deployed Supabase functions.

- `run.js`: the checks, with assertions. Results go to `tests/out/results.json`.
- `harness.js`: the fake servers. `server: "current"` mimics the deployed enhance function;
  `server: "patched"` mimics the prepared change in `supabase/` (request ids, `?request=`, `refunded`).
- `fixtures/`: synthetic photos made by `make-fixtures.py` (gradients, no people).
- Set `GLOW_TEST_FACE=/path/to/portrait.jpg` to add the face-tool check.

The earlier exploratory scripts (t1–t4, log output only) were replaced by `run.js`.
