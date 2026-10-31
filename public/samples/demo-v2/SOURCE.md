# Try a sample: sources

This folder is versioned (`demo-v2`). A new sample gets a new folder, so phones never mix a
cached old file with the new ones. The service worker's cache name changes with it. Personal
drafts live in the browser's own storage and are never touched by a sample change.

## original.png

- An AI-generated portrait of an adult. It is not a photo of a real person.
- Approved by the Glow Studio owner on 2026-10-30 as the sample (the portrait in the approved editor
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

On 2026-10-30, with the owner's approval (about $1.05 of Replicate credit), every Glow Studio AI tool
except Try on (it needs an outfit photo) was run once on this exact original by
`tools/demo/all/all-tools.ts`, in a one-off GitHub Actions job (run 41081284106 on the
`demo-gen` branch). It reached Replicate through a temporary Supabase function that checked the
job's GitHub OIDC token, so the Replicate token never left Supabase; the function was retired
right after. The raw results and their provenance are on the `demo-gen` branch under
`tools/demo/all/out/`.

Each result was put in the original's frame with a uniform scale only, never a stretch. The
image-editing model returns 864 x 1184 with the sides trimmed, so those results are scaled to
the original's height and placed where they match best, and the thin side strips (at most 28 px)
come from the original; `fit` in `manifest.json` records this for each one. Then the eye region
was compared with the original: only results whose eyes moved 4 px or less ship here.

Shipped (11): Enhance, Restore, Face repair, AI retouch, Golden hour, Colorize, Pixie cut,
Business suit, Summer dress, 3D Toon, Clay.

Not shipped as previews: the hair styles other than Pixie, Smile, Relight, Gown and Streetwear
(the model moved or reframed the face), Headshot, Fashion, Anime and Watercolor (new pictures
with a different composition), Older and Younger (the model returns a square face crop), Upscale
(its point is the larger size), Remove and Fill (they need marks on the photo), and Expand (its
result filled the new area with unrelated pictures; see the run notes).

The JPEGs under `tests/fixtures/demo-test-*.jpg` are tone changes made for the tests only.
They are not Glow Studio results and are never shipped.
