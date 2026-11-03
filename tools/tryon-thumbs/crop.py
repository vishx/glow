# Makes the Try on outfit row photos (public/samples/tryon/<id>.webp) from the AI results.
import glob, os, re, sys
from PIL import Image, ImageChops, ImageFilter
D = "tools/tryon-thumbs/out/"; OUT = "public/samples/tryon/"
parts = dict((i, p) for i, p in re.findall(r'^  \["(\w+)", "[^"]*", "[^"]*", "(\w+)"', open("public/tryon.js").read(), re.M))
for f in sorted(glob.glob(D + "*.jpg")):
    i = os.path.basename(f)[:-4]
    if i not in parts: continue
    im = Image.open(f).convert("RGB"); W, H = im.size
    bg = Image.new("RGB", im.size, im.getpixel((8, 8)))
    m = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 38 else 0).filter(ImageFilter.MedianFilter(5))
    box = m.getbbox() or (0, 0, W, H)
    top = max(0, box[1] - int(0.025 * H))
    h = int((0.5 if parts[i] == "top" else 0.6) * H); w = int(h * 0.744)
    cx = (box[0] + box[2]) // 2; x = min(max(0, cx - w // 2), W - w)
    im.crop((x, top, x + w, top + h)).resize((192, 258), Image.LANCZOS).save(OUT + i + ".webp", quality=82, method=6)
    print(i, parts[i], box)
