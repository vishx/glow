"""Builds the launch-animation layers in public/splash/ (core lens and halo) from lens.py.

Run from the repo root after build.py:  python3 tools/app-icon/splash_layers.py
The iris blades are drawn by an inline SVG in index.html, and the sparkle is plain white, so neither is built here.
"""
import json, os, subprocess, sys, tempfile
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import lens

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp()
svg = lens.icon(bg="none", shadow_on=False)
head, rest = svg.split("<!-- iridescent halo -->", 1)
halo, rings = rest.split("<!-- rings -->", 1)
blade = rings.index('<polygon points="')
core = head + rings[:blade] + rings[rings.index("<!-- glass reflection arc -->"):rings.index("<!-- flare")] + "</svg>"
halo_svg = head + halo + "</svg>"
jobs = []
for name, s in (("core", core), ("halo", halo_svg)):
    p = os.path.join(TMP, name + ".svg"); open(p, "w").write(s)
    jobs.append({"svg": p, "png": os.path.join(TMP, name + ".png"), "size": 1024})
json.dump(jobs, open(os.path.join(TMP, "jobs.json"), "w"))
subprocess.run(["node", os.path.join(HERE, "render.js"), os.path.join(TMP, "jobs.json")], check=True)
for name, size in (("core", 768), ("halo", 512)):
    Image.open(os.path.join(TMP, name + ".png")).convert("RGBA").resize((size, size), Image.LANCZOS) \
        .save(f"public/splash/{name}.webp", quality=90, method=6)
print("splash layers built")
