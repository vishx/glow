# One-off sharpness test (owner approved 2026-10-31): runs the owner's photo through the current
# Enhance and candidate "sharper" approaches, saves every result and its timing to out/.
# Replicate is reached through the temporary Supabase function "sharp-test" (see proxy.ts).
import base64, io, json, os, sys, time, urllib.request, urllib.error
from PIL import Image, ImageOps

BASE = os.environ["REPLICATE_API_BASE"]; OIDC = os.environ["GH_OIDC"]
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)

def api(path, body=None, wait=False):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 headers={"x-gh-oidc": OIDC, "Content-Type": "application/json", **({"Prefer": "wait=55"} if wait else {})})
    for i in range(8):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code == 429 and i < 7: time.sleep(15); continue
            raise RuntimeError(f"{e.code} {msg}")

def data_url(img, q=92):
    b = io.BytesIO(); img.convert("RGB").save(b, "JPEG", quality=q); return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

def fit(img, max_px=None, max_side=None):
    w, h = img.size; k = 1.0
    if max_px: k = min(k, (max_px / (w * h)) ** 0.5)
    if max_side: k = min(k, max_side / max(w, h))
    return img if k >= 1 else img.resize((int(w * k), int(h * k)), Image.LANCZOS)

info_cache = {}
def model_info(model):
    if model in info_cache: return info_cache[model]
    m = api(f"/models/{model}"); v = m.get("latest_version") or {}
    props = (((v.get("openapi_schema") or {}).get("components") or {}).get("schemas") or {}).get("Input", {}).get("properties", {})
    key = next((k for k in ["image", "img", "input_image", "image_input", "input"] if k in props), "image")
    info_cache[model] = (v.get("id"), props, key); return info_cache[model]

def run(model, img, inputs, official=False):
    version, props, key = model_info(model)
    inp = {key: data_url(img)}
    for k, val in inputs.items():
        if not props or k in props: inp[k] = val
    t0 = time.time()
    p = api(f"/models/{model}/predictions" if official or not version else "/predictions", {"input": inp} if official or not version else {"version": version, "input": inp}, wait=True)
    while p["status"] not in ("succeeded", "failed", "canceled"):
        time.sleep(3); p = api(f"/predictions/{p['id']}")
    if p["status"] != "succeeded": raise RuntimeError(f"{model} {p['status']}: {p.get('error')}")
    out = p["output"]; out = out[-1] if isinstance(out, list) else out
    with urllib.request.urlopen(out, timeout=300) as r: res = Image.open(io.BytesIO(r.read())); res.load()
    return res, {"model": model, "version": version, "id": p["id"], "predict_time": (p.get("metrics") or {}).get("predict_time"), "wall": round(time.time() - t0, 1), "input": {k: v for k, v in inp.items() if k != key}, "in_size": img.size, "out_size": res.size}

def tiled(model, img, inputs, tile=900, overlap=64):
    """Enhances the full-size photo in overlapping tiles at its own size, feathered together."""
    W, H = img.size; out = Image.new("RGB", (W, H)); runs = []
    step = tile - overlap
    xs = list(range(0, max(1, W - overlap), step)); ys = list(range(0, max(1, H - overlap), step))
    for y in ys:
        for x in xs:
            box = (x, y, min(W, x + tile), min(H, y + tile))
            piece = img.crop(box)
            res, meta = run(model, piece, inputs); runs.append(meta)
            res = res.convert("RGB").resize(piece.size, Image.LANCZOS)
            mask = Image.new("L", piece.size, 255)
            # feather the left/top edges that overlap an earlier tile
            from PIL import ImageDraw
            d = ImageDraw.Draw(mask)
            for i in range(overlap):
                a = int(255 * (i + 1) / (overlap + 1))
                if x > 0: d.line([(i, 0), (i, piece.size[1])], fill=a)
            for i in range(overlap):
                a = int(255 * (i + 1) / (overlap + 1))
                if y > 0:
                    row = Image.new("L", (piece.size[0], 1), a)
                    cur = mask.crop((0, i, piece.size[0], i + 1))
                    from PIL import ImageChops
                    mask.paste(ImageChops.darker(cur, row), (0, i))
            out.paste(res, box[:2], mask)
    return out, runs

src = Image.open(os.path.join(HERE, "input.jpg")); src = ImageOps.exif_transpose(src).convert("RGB")
full = fit(src, max_px=12_500_000)
print("input", src.size, "-> using", full.size, flush=True)
results = {}
def save(name, img, meta):
    f = f"{name}.jpg"; img.convert("RGB").save(os.path.join(OUT, f), "JPEG", quality=93)
    results[name] = {"file": f, **meta}; print("saved", name, img.size, flush=True)
    json.dump(results, open(os.path.join(OUT, "results.json"), "w"), indent=2, default=str)

jobs = {
  "A_current": lambda: run("nightmareai/real-esrgan", fit(full, max_px=900_000, max_side=1280), {"scale": 2, "face_enhance": True}),
  "B_tiled": lambda: (lambda o: (o[0], {"model": "nightmareai/real-esrgan (tiles)", "tiles": len(o[1]), "predict_time": round(sum((r["predict_time"] or 0) for r in o[1]), 1), "runs": o[1]}))(tiled("nightmareai/real-esrgan", full, {"scale": 2, "face_enhance": True})),
  "C_clarity": lambda: run("philz1337x/clarity-upscaler", fit(full, max_px=1_500_000), {"scale_factor": 2, "creativity": 0.25, "resemblance": 0.8, "dynamic": 6, "prompt": "masterpiece, best quality, highres, sharp focus, natural skin", "output_format": "jpg"}),
  "D_recraft": lambda: run("recraft-ai/recraft-crisp-upscale", fit(full, max_px=4_000_000), {}, official=True),
  "E_topaz": lambda: run("topazlabs/image-upscale", fit(full, max_px=6_000_000), {"enhance_model": "Standard V2", "upscale_factor": "2x", "face_enhancement": True, "output_format": "jpg"}, official=True),
}
only = sys.argv[1:]
for name, job in jobs.items():
    if only and name not in only: continue
    try:
        img, meta = job(); save(name, img, meta)
    except Exception as e:
        results[name] = {"error": str(e)[:400]}; print("FAILED", name, e, flush=True)
        json.dump(results, open(os.path.join(OUT, "results.json"), "w"), indent=2, default=str)
