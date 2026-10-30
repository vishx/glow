# Builds the inputs for the one-off "every AI tool on the sample" run from the exact sample
# original, the way the app builds them:
#   input.jpg      the original as the app uploads it (JPEG quality 90, 1086 x 1448)
#   erase-mask.png Remove: flyaway hair strands at the left edge of the hair (white = remove)
#   fill-mask.png  Fill: a small area at the neckline, with the prompt in all-tools.ts
#   expand-*.jpg/png  Expand: the photo at most 1024 px, 20% wider and 15% taller on each side,
#                  grey padding, white mask outside a 6 px inset (as engine.js expandInputs)
import os
from PIL import Image, ImageDraw, ImageFilter
here = os.path.dirname(os.path.abspath(__file__))
orig = Image.open(os.path.join(here, "../../../public/samples/demo-v2/original.png")).convert("RGB")
W, H = orig.size
orig.save(os.path.join(here, "input.jpg"), quality=90)
def mask(draw):
    m = Image.new("L", (W, H), 0); draw(ImageDraw.Draw(m)); return m
mask(lambda d: d.ellipse([70, 560, 180, 790], fill=255)).save(os.path.join(here, "erase-mask.png"))
mask(lambda d: d.ellipse([470, 770, 650, 860], fill=255)).save(os.path.join(here, "fill-mask.png"))
s = min(1, 1024 / max(W, H)); bw, bh = round(W * s), round(H * s)
pw, ph = round(bw * 0.2), round(bh * 0.15)
canvas = Image.new("RGB", (bw + 2 * pw, bh + 2 * ph), (128, 128, 128)); canvas.paste(orig.resize((bw, bh), Image.LANCZOS), (pw, ph))
canvas.save(os.path.join(here, "expand-image.jpg"), quality=92)
m = Image.new("L", canvas.size, 255); ImageDraw.Draw(m).rectangle([pw + 6, ph + 6, pw + bw - 7, ph + bh - 7], fill=0)
m.save(os.path.join(here, "expand-mask.png"))
print("inputs ready", W, H, canvas.size)
