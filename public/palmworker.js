// Show palm, for the web camera: looks for an open hand facing the camera with MediaPipe's
// gesture recognizer, off the main thread (like faceworker.js, and loaded the same way). The phone
// apps run the same model natively (PalmTracker.java / PalmTracker.swift).
// Messages in: init { base, model }, frame { image, t } (an ImageBitmap, closed here).
// Messages out: ready, failed { error }, result { hand } where hand is [score, x, y, w, h]
// (a box in the frame, 0..1) or null.
let rec = null, vision = null, fileset = null, model = "";
const make = (delegate) => vision.GestureRecognizer.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: model, delegate }, runningMode: "VIDEO", numHands: 2,
  minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
});
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "init") {
    try {
      const src = await (await fetch(`${m.base}/vision_bundle.cjs`)).text();
      self.exports = {}; importScripts(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); vision = self.exports;
      fileset = await vision.FilesetResolver.forVisionTasks(`${m.base}/wasm`);
      model = m.model;
      // The CPU: a hand is small work, and some phone GPUs return NaN points (see faceworker.js).
      rec = await make("CPU");
      self.postMessage({ type: "ready" });
    } catch (err) { self.postMessage({ type: "failed", error: String(err && err.message || err) }); }
    return;
  }
  if (m.type !== "frame") return;
  let hand = null;
  try { hand = best(rec.recognizeForVideo(m.image, m.t)); } catch {}
  if (m.image.close) m.image.close();
  self.postMessage({ type: "result", hand });
};
// The surest open palm with its fingers pointing up (middle fingertip above the wrist).
function best(r) {
  let out = null;
  const G = (r && r.gestures) || [], L = (r && r.landmarks) || [];
  for (let i = 0; i < Math.min(G.length, L.length); i++) {
    const g = G[i] && G[i][0], lm = L[i];
    if (!g || g.categoryName !== "Open_Palm" || !lm || lm.length < 21 || lm[12].y >= lm[0].y) continue;
    if (!lm.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
    const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    if (!out || g.score > out[0]) out = [g.score, x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
  }
  return out;
}
