# Turns each generated sample result into the shipped preview asset and marks it ready.
#   python3 tools/demo/optimize.py
# For every manifest entry with status "generated": if the result has the original's aspect
# ratio (within 2%), it is resized to exactly the original's size so before/after lines up;
# otherwise it keeps its own frame, is marked "aligned": false and status "unaligned", and the app never offers it. Saved as a
# progressive JPEG, quality 88. Needs Pillow. The raw model output is kept out of the app.
import hashlib, json, os, shutil
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
demo = os.path.join(here, "..", "..", "public", "samples", "demo-v2")
raw_dir = os.path.join(here, "raw")
os.makedirs(raw_dir, exist_ok=True)
path = os.path.join(demo, "manifest.json")
m = json.load(open(path))
W, H = m["original"]["width"], m["original"]["height"]
for e in m["previews"]:
    if e.get("status") != "generated":
        continue
    src = os.path.join(demo, e["raw"])
    im = Image.open(src).convert("RGB")
    aligned = abs(im.width / im.height - W / H) < 0.02 * (W / H)
    if aligned:
        im = im.resize((W, H), Image.LANCZOS)
    out = f"{e['tool']}.jpg"
    im.save(os.path.join(demo, out), quality=88, progressive=True, optimize=True)
    shutil.move(src, os.path.join(raw_dir, e["raw"]))
    # A reframed result can't be compared with the original, so it is never offered.
    e.update(status="ready" if aligned else "unaligned", result=out, width=im.width, height=im.height, aligned=aligned,
             sha256=hashlib.sha256(open(os.path.join(demo, out), "rb").read()).hexdigest())
    del e["raw"]
    print(f"{e['tool']}: {out} {im.width}x{im.height} aligned={aligned}")
json.dump(m, open(path, "w"), indent=2, ensure_ascii=False)
