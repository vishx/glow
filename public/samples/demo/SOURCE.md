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

As of 2026-10-30, none is ready yet. All six need one paid run each (see the review notes).
They are made like this:

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
