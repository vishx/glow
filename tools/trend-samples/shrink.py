# Card thumbnails: 360 px wide WebP (about 20 KB each) into public/samples/trends/.
import os, sys
from PIL import Image
src = os.path.join(os.path.dirname(__file__), "out"); dst = os.path.join(os.path.dirname(__file__), "../../public/samples/trends")
os.makedirs(dst, exist_ok=True)
for f in sorted(os.listdir(src)):
    if not f.endswith(".jpg"): continue
    im = Image.open(os.path.join(src, f)).convert("RGB"); w = 360; h = round(im.height * w / im.width)
    im.resize((w, h), Image.LANCZOS).save(os.path.join(dst, f.replace(".jpg", ".webp")), "WEBP", quality=80, method=6)
    print("thumb", f)
