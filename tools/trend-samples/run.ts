// One-off (owner asked 2026-11-02): one sample picture per trend, made with the app's real pipeline
// (same models and prompts users get) on the AI-generated sample person (tools/demo/input.jpg).
// REPLICATE_API_BASE points at the temporary "trend-samples" function; REPLICATE_API_TOKEN holds the
// workflow's GitHub OIDC token, which that function checks. No Replicate token is ever on GitHub.
import { HttpError, lastOutput, MODES, rep, startPrediction } from "../../supabase/functions/enhance/pipeline.ts";

const modes = Deno.args.length ? Deno.args : ["trend_figurine", "trend_yearbook", "trend_poster", "trend_polaroid", "trend_snow", "trend_holiday"];
const input = await Deno.readFile(new URL("../demo/input.jpg", import.meta.url));
const image = "data:image/jpeg;base64," + btoa(Array.from(input, (b) => String.fromCharCode(b)).join(""));
await Deno.mkdir(new URL("out/", import.meta.url), { recursive: true });
const logUrl = new URL("out/results.json", import.meta.url);
const log: Record<string, unknown> = await Deno.readTextFile(logUrl).then(JSON.parse).catch(() => ({}));
for (const mode of modes) {
  console.log(`running ${mode}…`);
  let started;
  for (let i = 0; ; i++) {
    try { started = await startPrediction(MODES[mode], { image }, false); break; }
    catch (e) { if (!(e instanceof HttpError) || e.status !== 429 || i >= 8) throw e; await new Promise((r) => setTimeout(r, 15000)); }
  }
  let { p, info } = started;
  while (!["succeeded", "failed", "canceled"].includes(p.status)) { await new Promise((r) => setTimeout(r, 3000)); p = await rep(`/predictions/${p.id}`); }
  if (p.status !== "succeeded") { console.error(`${mode} ${p.status}: ${p.error ?? ""}`); log[mode] = { status: p.status }; continue; }
  const out = await fetch(lastOutput(p.output) as string);
  await Deno.writeFile(new URL(`out/${mode}.jpg`, import.meta.url), new Uint8Array(await out.arrayBuffer()));
  log[mode] = { status: "ok", model: info.model, prediction: p.id, secs: p.metrics?.predict_time ?? null };
  console.log(`  saved (${info.model})`);
}
await Deno.writeTextFile(logUrl, JSON.stringify(log, null, 2) + "\n");
