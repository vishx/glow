# Makes the test photos in fixtures/. Run with: python3 tests/make-fixtures.py (needs Pillow).
# They are synthetic (gradients and shapes), so they carry no license or privacy questions.
import os
from PIL import Image, ImageDraw
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(out, exist_ok=True)

def gradient(w, h):
    g = Image.linear_gradient("L").resize((w, h))
    return Image.merge("RGB", (g, g.rotate(90).resize((w, h)), Image.new("L", (w, h), 140)))

# A 12-megapixel phone photo stored landscape with EXIF orientation 6 (rotate 90° clockwise),
# so it should display as 3024 × 4032 portrait. A red block marks the stored top-left corner,
# which ends up at the displayed top-right.
im = gradient(4032, 3024)
ImageDraw.Draw(im).rectangle((0, 0, 400, 400), fill=(230, 20, 20))
exif = Image.Exif(); exif[0x0112] = 6
im.save(os.path.join(out, "phone-12mp-exif6.jpg"), quality=85, exif=exif.tobytes())

# A 24-megapixel photo: larger than Glow's 16-megapixel export limit.
gradient(6000, 4000).save(os.path.join(out, "large-24mp.jpg"), quality=80)

# A PNG with transparent corners.
a = Image.new("RGBA", (1200, 900), (0, 0, 0, 0))
ImageDraw.Draw(a).ellipse((150, 50, 1050, 850), fill=(200, 120, 160, 255))
a.save(os.path.join(out, "transparent.png"))
