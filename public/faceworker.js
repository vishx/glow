// Finds the face for the live camera, off the main thread, so the preview never waits for it.
// Loaded as a classic worker by livebeauty.js: MediaPipe loads its own files with importScripts,
// which module workers don't allow, so this uses the library's CommonJS build. Messages in: init { base, model }, frame { image,
// t } (an ImageBitmap, closed here). Messages out: ready, failed, result { pts, cost } where pts
// holds x, y pairs from 0 to 1, or null when no face is in view.
let finder = null, vision = null, fileset = null, model = "", gpu = false;
const make = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: model, delegate }, runningMode: "VIDEO", numFaces: 1,
});
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "init") {
    try {
      // Fetched and run as JavaScript whatever type the server labels a .cjs file with.
      const src = await (await fetch(`${m.base}/vision_bundle.cjs`)).text();
      self.exports = {}; importScripts(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); vision = self.exports;
      fileset = await vision.FilesetResolver.forVisionTasks(`${m.base}/wasm`);
      model = m.model;
      // The GPU is faster where a worker can use it; otherwise the CPU.
      try { finder = await make("GPU"); gpu = true; } catch { finder = await make("CPU"); }
      self.postMessage({ type: "ready" });
    } catch (err) { self.postMessage({ type: "failed", error: String(err && err.message || err) }); }
    return;
  }
  if (m.type !== "frame") return;
  const t0 = performance.now();
  let pts = null;
  try {
    pts = find(m.image, m.t);
    // Some phone GPUs (seen on Android Chrome) run the model but return NaN points, so no face is
    // ever found. Those phones switch to the CPU, which is slower but right, and still off-screen.
    if (pts && !pts.every(Number.isFinite)) { pts = null; if (gpu) { await toCpu("GPU gave NaN face points"); pts = find(m.image, m.t + 1); } }
    if (pts && !pts.every(Number.isFinite)) pts = null;
  } catch (err) {
    // A GPU that can't run the model here gets one retry on the CPU.
    if (gpu) await toCpu(String(err && err.message || err));
  }
  if (m.image.close) m.image.close();
  self.postMessage({ type: "result", pts, cost: performance.now() - t0 }, pts ? [pts.buffer] : []);
};
function find(image, t) {
  const r = finder.detectForVideo(image, t), lm = r && r.faceLandmarks && r.faceLandmarks[0];
  if (!lm) return null;
  const pts = new Float32Array(lm.length * 2);
  lm.forEach((p, i) => { pts[i * 2] = p.x; pts[i * 2 + 1] = p.y; });
  return pts;
}
async function toCpu(why) {
  gpu = false;
  try { finder.close(); } catch {}
  try { finder = await make("CPU"); self.postMessage({ type: "note", text: `Live camera face finder moved to the CPU: ${why}` }); }
  catch (err) { self.postMessage({ type: "failed", error: String(err && err.message || err) }); }
}
