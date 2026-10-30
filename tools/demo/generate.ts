// Makes the prepared AI results for Try a sample, once, with Glow's real AI pipeline.
//
// It runs each entry in public/samples/demo-v2/manifest.json whose status is "needs-generation"
// through supabase/functions/enhance/pipeline.ts: the same models, prompts and settings the
// app's users get. It saves each result next to the manifest and records provenance.
// It does not go through the enhance function, so it doesn't use anyone's AI credits, but
// each run is billed to the Replicate account whose token you pass. Run it only with the
// owner's go-ahead.
//
//   REPLICATE_API_TOKEN=... deno run --allow-env --allow-net --allow-read --allow-write tools/demo/generate.ts [tool ...]
//
// Then run tools/demo/optimize.py to fit each result to the original's frame and size.
// The token is read from the environment only; nothing secret is written to disk.
import { HttpError, lastOutput, MODES, rep, startPrediction } from "../../supabase/functions/enhance/pipeline.ts";

const dir = new URL("../../public/samples/demo-v2/", import.meta.url);
const manifestUrl = new URL("manifest.json", dir);
const manifest = JSON.parse(await Deno.readTextFile(manifestUrl));
const only = Deno.args;
const input = await Deno.readFile(new URL("input.jpg", import.meta.url));
const image = "data:image/jpeg;base64," + btoa(Array.from(input, (b) => String.fromCharCode(b)).join(""));

for (const entry of manifest.previews) {
  if (entry.status !== "needs-generation" || (only.length && !only.includes(entry.tool))) continue;
  const cfg = MODES[entry.tool];
  if (!cfg) { console.error(`skip ${entry.tool}: not a Glow AI tool`); continue; }
  console.log(`running ${entry.tool}…`);
  // Replicate throttles new predictions on small accounts (6 a minute, 1 at a time), so wait
  // and try again on a 429 rather than give up. A throttled request isn't run or billed.
  let started;
  for (let i = 0; ; i++) {
    try { started = await startPrediction(cfg, { image }); break; }
    catch (e) { if (!(e instanceof HttpError) || e.status !== 429 || i >= 6) throw e; await new Promise((r) => setTimeout(r, 15000)); }
  }
  let { p, info } = started;
  while (!["succeeded", "failed", "canceled"].includes(p.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    p = await rep(`/predictions/${p.id}`);
  }
  if (p.status !== "succeeded") { console.error(`${entry.tool} ${p.status}: ${p.error ?? ""}`); continue; }
  const out = await fetch(lastOutput(p.output) as string);
  const type = out.headers.get("content-type") ?? "image/jpeg";
  const file = `${entry.tool}.raw.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`;
  await Deno.writeFile(new URL(file, dir), new Uint8Array(await out.arrayBuffer()));
  entry.status = "generated";
  entry.raw = file;
  // Provenance only: no signed output URL, no token.
  entry.provenance = { originalSha256: manifest.original.sha256, generatedAt: new Date().toISOString(), pipeline: "supabase/functions/enhance/pipeline.ts", model: info.model,
    version: info.version, predictionId: p.id, metrics: p.metrics ?? null };
  await Deno.writeTextFile(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  saved ${file} (${info.model})`);
}
