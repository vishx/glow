# Try a sample: sources

## original.png

- An AI-generated portrait of an adult. It is not a photo of a real person.
- Supplied by the Glow owner on 2026-10-30, in the project thread, for use as the in-app sample.
- Shipped byte-for-byte as received: 1122 × 1402 PNG, SHA-256
  `c2d25a5e098f018268d1b883c8b4ec496bd303dff4548fb82bf71ca0d1ffe193`.
- **To fill in before release:** which generator made it, and confirmation that its terms
  allow use in a commercial app.

## Prepared AI previews

These are listed in `manifest.json`, which records for each one the tool id, the settings, the
input, the output file and its provenance. The app offers an entry only when its status is
`ready` and its file loads.

All six were made on 2026-10-30, once each, with the owner's approval, by
`tools/demo/generate.ts` running in a one-off GitHub Actions job ("Demo previews" on the
`demo-gen` branch). It reached Replicate through a temporary Supabase function that checked the
job's GitHub OIDC token, so the Replicate token never left Supabase; that function was retired
right after. Each entry in `manifest.json` records the model, the prediction id and the time.

| Preview | Model | Size | Lines up with the original |
| --- | --- | --- | --- |
| Retouch | sczhou/codeformer | 1122 × 1402 | yes |
| Enhance | google/nano-banana | 896 × 1152 | close (the model returns 7:9) |
| Relight | google/nano-banana | 896 × 1152 | close (the model returns 7:9) |
| Golden hour | google/nano-banana | 896 × 1152 | no, the model reframed it |
| Sleek bob | google/nano-banana | 896 × 1152 | no, the model reframed it |
| 3D Toon | fofr/face-to-many | 1122 × 1402 | yes (a new picture by design) |

Results are shown as the model returned them, resized only when their shape already matched
the original. Nothing was retouched by hand or made with another generator.

To remake them, the steps are:

1. `REPLICATE_API_TOKEN=… deno run --allow-env --allow-net --allow-read --allow-write tools/demo/generate.ts`
   - This uses `supabase/functions/enhance/pipeline.ts`: the same models, prompts and settings
     that users get.
   - The input is `tools/demo/input.jpg`. That is this original as the app uploads it: a JPEG at
     quality 90, 1122 × 1402.
   - The script records the model, version, prediction id and time. It never writes a URL or a
     token.
2. `python3 tools/demo/optimize.py`
   - Fits each result to the original's size when the framing matches.
   - Saves a progressive JPEG and marks the entry `ready`.

The JPEGs under `tests/fixtures/demo-test-*.jpg` are tone changes made for the tests only.
They are not Glow results and are never shipped.

## thumb.jpg and intro.jpg

Smaller copies of `original.png`, resized only (176 × 220 and 720 × 900, JPEG): the Editor
landing's sample card and the introduction screens use them so they load fast. The editor
always compares against `original.png` itself.
