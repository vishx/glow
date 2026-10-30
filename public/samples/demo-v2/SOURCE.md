# Try a sample: sources

This folder is versioned (`demo-v2`). A new sample gets a new folder, so phones never mix a
cached old file with the new ones. The service worker's cache name changes with it. Personal
drafts live in the browser's own storage and are never touched by a sample change.

## original.png

- An AI-generated portrait of an adult. It is not a photo of a real person.
- Approved by the Glow owner on 2026-10-30 as the sample (the portrait in the approved editor
  mockup), replacing the earlier sample.
- Shipped byte-for-byte as received: 1086 × 1448 PNG, SHA-256
  `5bf7bc4f3d96afd2dd9abfb7cbd7229de64cae3c8ab7f24897ff251f66d252d4`.
- **To fill in before release:** which generator made it, and confirmation that its terms
  allow use in a commercial app.

## thumb.jpg and intro.jpg

Smaller copies of `original.png`, resized only (176 × 235 and 720 × 960, JPEG): the Editor
landing's sample card and the welcome screen use them so they load fast. The editor always
compares against `original.png` itself.

## Prepared AI previews

`manifest.json` lists the AI tools that can show a prepared result on the sample. None ship
yet: the results made from the earlier sample were removed, and new ones must be made from
this exact original. The app offers an entry only when its status is `ready`, it is marked
`aligned: true` (same size and framing as the original) and its file loads. The tests also
check that each shipped result has the original's size and records `originalSha256` equal to
this original's hash.

To make them (each run is billed to the Replicate account whose token is used, so only with
the owner's go-ahead):

1. `REPLICATE_API_TOKEN=… deno run --allow-env --allow-net --allow-read --allow-write tools/demo/generate.ts`
   - This uses `supabase/functions/enhance/pipeline.ts`: the same models, prompts and settings
     that users get.
   - The input is `tools/demo/input.jpg`: this original as the app uploads it, a JPEG at
     quality 90, 1086 × 1448.
   - The script records the original's hash, the model, version, prediction id and time. It
     never writes a URL or a token.
2. `python3 tools/demo/optimize.py`
   - Fits each result to the original's size only when its framing already matches.
   - Results that the model reframed are kept out of the app.

The JPEGs under `tests/fixtures/demo-test-*.jpg` are tone changes made for the tests only.
They are not Glow results and are never shipped.
