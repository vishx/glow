"""Builds every Glow app icon, store icon and splash screen from lens.py.

Run from the repo root:  python3 tools/app-icon/build.py
Needs Pillow and Playwright's Chromium (node tools/app-icon/render.js does the SVG rendering).
"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageOps
sys.path.insert(0, os.path.dirname(__file__))
import lens

ROOT = os.getcwd()
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp()
ANDROID_SCALE = 0.86  # keeps the lens and sparkle inside the 66dp adaptive-icon safe circle
INK = (18, 16, 20)    # app background #121014

svgs = {
    "full": lens.icon(bg="metal"),
    "bg": lens.background(),
    "lens": lens.icon(bg="none"),
    "lens_flat": lens.icon(bg="none", shadow_on=False),
    "android_fg": lens.scaled(lens.icon(bg="none"), ANDROID_SCALE),
    "mono": lens.scaled(lens.monochrome(), ANDROID_SCALE),
}
jobs = []
for name, svg in svgs.items():
    p = os.path.join(TMP, name + ".svg")
    open(p, "w").write(svg)
    jobs.append({"svg": p, "png": os.path.join(TMP, name + ".png"), "size": 1024})
json.dump(jobs, open(os.path.join(TMP, "jobs.json"), "w"))
subprocess.run(["node", os.path.join(HERE, "render.js"), os.path.join(TMP, "jobs.json")], check=True)
img = {n: Image.open(os.path.join(TMP, n + ".png")).convert("RGBA") for n in svgs}

def out(path):
    path = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path

def save(im, path, size=None, opaque=False):
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    if opaque:
        im = im.convert("RGB")
    im.save(out(path), optimize=True)

def over(a, b):
    c = a.copy(); c.alpha_composite(b); return c

def mask(im, shape, inset=0.0):
    n = im.width; m = Image.new("L", (n, n), 0); d = ImageDraw.Draw(m)
    box = [n * inset, n * inset, n * (1 - inset) - 1, n * (1 - inset) - 1]
    if shape == "circle":
        d.ellipse(box, fill=255)
    else:
        d.rounded_rectangle(box, radius=(box[2] - box[0]) * 0.2237, fill=255)
    r = Image.new("RGBA", (n, n), (0, 0, 0, 0)); r.paste(im, (0, 0), m)
    return r

full = img["full"]
android_full = over(img["bg"], img["android_fg"])

# Tinted (iOS 18+/26): grayscale artwork on black; the system applies the tint.
gray = ImageOps.grayscale(img["lens_flat"]).convert("RGBA")
gray.putalpha(img["lens_flat"].getchannel("A"))
tinted = over(Image.new("RGBA", full.size, (0, 0, 0, 255)), gray)

# Brand masters
open(out("brand/app-icon.svg"), "w").write(svgs["full"])
open(out("brand/icon-background.svg"), "w").write(svgs["bg"])
open(out("brand/icon-foreground.svg"), "w").write(svgs["android_fg"])
open(out("brand/icon-monochrome.svg"), "w").write(svgs["mono"])
save(full, "brand/app-icon-1024.png", opaque=True)
save(img["android_fg"], "brand/icon-foreground-1024.png")
save(img["bg"], "brand/layers/background-1024.png", opaque=True)
save(img["lens"], "brand/layers/lens-1024.png")
save(img["lens_flat"], "brand/layers/lens-dark-1024.png")
save(full, "brand/store/app-store-1024.png", opaque=True)
save(full, "brand/store/play-store-512.png", 512, opaque=True)

# iOS app icon: default, dark and tinted appearances
ios = "mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/"
save(full, ios + "AppIcon-512@2x.png", opaque=True)
save(img["lens_flat"], ios + "AppIcon-Dark-1024.png")
save(tinted, ios + "AppIcon-Tinted-1024.png", opaque=True)
json.dump({
    "images": [
        {"filename": "AppIcon-512@2x.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
        {"appearances": [{"appearance": "luminosity", "value": "dark"}], "filename": "AppIcon-Dark-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
        {"appearances": [{"appearance": "luminosity", "value": "tinted"}], "filename": "AppIcon-Tinted-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
    ],
    "info": {"author": "xcode", "version": 1},
}, open(out(ios + "Contents.json"), "w"), indent=2)

# Android adaptive (108dp layers), legacy and round icons
res = "mobile/android/app/src/main/res/"
for dpi, k in (("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)):
    layer, legacy = int(108 * k), int(48 * k)
    save(img["android_fg"], f"{res}mipmap-{dpi}/ic_launcher_foreground.png", layer)
    save(img["bg"], f"{res}mipmap-{dpi}/ic_launcher_background.png", layer, opaque=True)
    save(img["mono"], f"{res}mipmap-{dpi}/ic_launcher_monochrome.png", layer)
    # Legacy launchers show the 72dp centre of the 108dp layers.
    crop = android_full.crop((int(1024 * 18 / 108),) * 2 + (int(1024 * 90 / 108),) * 2)
    save(mask(crop, "square"), f"{res}mipmap-{dpi}/ic_launcher.png", legacy)
    save(mask(crop, "circle"), f"{res}mipmap-{dpi}/ic_launcher_round.png", legacy)

# Web app (PWA) icons
save(full, "public/icon-180.png", 180, opaque=True)
save(full, "public/icon-192.png", 192, opaque=True)
save(full, "public/icon-512.png", 512, opaque=True)
save(android_full, "public/icon-512-maskable.png", 512, opaque=True)

# Splash screens: the lens on the app's ink background
def splash(w, h, frac):
    s = Image.new("RGBA", (w, h), INK + (255,))
    n = int(min(w, h) * frac)
    l = img["lens_flat"].resize((n, n), Image.LANCZOS)
    s.alpha_composite(l, ((w - n) // 2, (h - n) // 2))
    return s.convert("RGB")
for f in subprocess.run(["git", "ls-files", "mobile/*splash*.png"], capture_output=True, text=True, check=True).stdout.split():
    w, h = Image.open(f).size
    splash(w, h, 0.26 if w == h else 0.42).save(f, optimize=True)
print("icons built")
