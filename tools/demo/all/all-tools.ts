// One-off: runs every Glow AI tool once on the sample portrait, with the same models, prompts
// and settings users get (supabase/functions/enhance/pipeline.ts), and saves each result with
// its provenance. The owner approved this run on 2026-10-30 (about $1.05 of Replicate credit).
// Try on is left out: it needs a photo of an outfit, and we have none we may use.
//   REPLICATE_API_TOKEN=... deno run --allow-env --allow-net --allow-read --allow-write tools/demo/all/all-tools.ts
import { HttpError, lastOutput, MODES, rep, startPrediction } from "../../../supabase/functions/enhance/pipeline.ts";

const here = new URL("./", import.meta.url), outDir = new URL("out/", here);
await Deno.mkdir(outDir, { recursive: true });
const dataUrl = async (f: string, type: string) => `data:${type};base64,` + btoa(Array.from(await Deno.readFile(new URL(f, here)), (b) => String.fromCharCode(b)).join(""));
const manifest = JSON.parse(await Deno.readTextFile(new URL("../../../public/samples/demo-v2/manifest.json", here)));
const image = await dataUrl("input.jpg", "image/jpeg");
const jobs: Record<string, { image?: string; mask?: string; prompt?: string }> = {
  erase: { mask: await dataUrl("erase-mask.png", "image/png") },
  fill: { mask: await dataUrl("fill-mask.png", "image/png"), prompt: "a delicate thin gold necklace with a small pendant" },
  expand: { image: await dataUrl("expand-image.jpg", "image/jpeg"), mask: await dataUrl("expand-mask.png", "image/png") },
};
const only = Deno.args, results: Record<string, unknown> = {};
const resultsUrl = new URL("results.json", outDir);
try { Object.assign(results, JSON.parse(await Deno.readTextFile(resultsUrl))); } catch { /* first run */ }
for (const mode of Object.keys(MODES)) {
  if (mode === "outfit" || (only.length && !only.includes(mode)) || (results[mode] as { file?: string })?.file) continue;
  const cfg = MODES[mode], job = jobs[mode] ?? {};
  console.log(`running ${mode}…`);
  try {
    let started;
    for (let i = 0; ; i++) {
      try { started = await startPrediction(cfg, { image: job.image ?? image, mask: job.mask, prompt: job.prompt }); break; }
      catch (e) { if (!(e instanceof HttpError) || e.status !== 429 || i >= 8) throw e; await new Promise((r) => setTimeout(r, 15000)); }
    }
    let { p, info } = started;
    while (!["succeeded", "failed", "canceled"].includes(p.status)) { await new Promise((r) => setTimeout(r, 3000)); p = await rep(`/predictions/${p.id}`); }
    if (p.status !== "succeeded") { results[mode] = { error: `${p.status}: ${p.error ?? ""}`, model: info.model, predictionId: p.id }; console.error(mode, p.status, p.error); }
    else {
      const res = await fetch(lastOutput(p.output) as string), type = res.headers.get("content-type") ?? "image/jpeg";
      const file = `${mode}.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`;
      await Deno.writeFile(new URL(file, outDir), new Uint8Array(await res.arrayBuffer()));
      results[mode] = { file, model: info.model, version: info.version, predictionId: p.id, originalSha256: manifest.original.sha256,
        generatedAt: new Date().toISOString(), metrics: p.metrics ?? null, prompt: job.prompt ?? null };
      console.log(`  saved ${file} (${info.model})`);
    }
  } catch (e) { results[mode] = { error: (e as Error).message }; console.error(mode, (e as Error).message); }
  await Deno.writeTextFile(resultsUrl, JSON.stringify(results, null, 2) + "\n");
}
