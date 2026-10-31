# One-off pro edit model test (owner approval asked 2026-10-31): runs each photo in this folder
# through candidate image-edit models with a professional photographer/retoucher prompt, then
# scores how true each result keeps every face (ArcFace similarity to the original face, 1.0 =
# identical) and also scores the "face-true finish" the app applies on the phone.
# Replicate is reached through the temporary Supabase function "pro-test" (see proxy.ts).
import base64, io, json, os, sys, time, urllib.request, urllib.error
import numpy as np
from PIL import Image, ImageFilter

BASE = os.environ["REPLICATE_API_BASE"]
_tok = {"v": None, "t": 0}
def oidc():
    if time.time() - _tok["t"] > 180:
        req = urllib.request.Request(os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=glow-pro-test",
                                     headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
        with urllib.request.urlopen(req, timeout=30) as r: _tok["v"] = json.loads(r.read())["value"]
        _tok["t"] = time.time()
    return _tok["v"]
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)

def api(path, body=None, wait=False):
    for i in range(8):
        req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                     method="POST" if body is not None else "GET",
                                     headers={"x-gh-oidc": oidc(), "Content-Type": "application/json", **({"Prefer": "wait=55"} if wait else {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code == 429 and i < 7: time.sleep(15); continue
            raise RuntimeError(f"{e.code} {msg}")

def data_url(img, q=93):
    b = io.BytesIO(); img.convert("RGB").save(b, "JPEG", quality=q); return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

PROMPT = ("Edit this photo the way a professional photographer and photo retoucher would finish it for delivery. "
  "Correct the white balance so whites look neutral and skin tones look natural and true. "
  "Fix the exposure: brighten and evenly light the faces and people, recover highlights and shadows, add gentle contrast and a clean, polished, natural color grade. "
  "Retouch skin lightly: reduce blemishes, shine and under-eye shadows while keeping real skin texture. Remove noise and sharpen the eyes and fine detail. "
  "Tidy the background: reduce small distractions and give it a subtle, natural depth of field so the people stand out. "
  "Keep every person exactly as they are: the same face, identity, facial features, face shape, expression, age, skin tone, hair, body, pose and clothes. "
  "Keep the same framing, composition and place. Photorealistic. Do not add objects or text.")

# name -> (model, extra inputs, list price per image, note)
MODELS = {
  "nano_banana":   ("google/nano-banana", {"output_format": "jpg"}, 0.039, "current editor Pro edit"),
  "nano_banana_2": ("google/nano-banana-2", {"output_format": "jpg", "resolution": "2K", "aspect_ratio": "match_input_image"}, None, ""),
  "nano_banana_pro": ("google/nano-banana-pro", {"output_format": "jpg", "resolution": "2K", "aspect_ratio": "match_input_image"}, 0.15, ""),
  "kontext_pro":   ("black-forest-labs/flux-kontext-pro", {"output_format": "jpg", "aspect_ratio": "match_input_image"}, 0.04, "current fallback"),
  "flux_2_pro":    ("black-forest-labs/flux-2-pro", {"output_format": "jpg", "aspect_ratio": "match_input_image"}, None, ""),
  "seedream_4":    ("bytedance/seedream-4", {"size": "2K", "aspect_ratio": "match_input_image"}, 0.03, ""),
  "qwen_edit_plus": ("qwen/qwen-image-edit-plus", {"output_format": "jpg", "aspect_ratio": "match_input_image"}, 0.03, ""),
}
IMAGE_KEYS = ["image_input", "input_images", "input_image", "image", "images", "img"]

def run(model, img, extra):
    m = api(f"/models/{model}"); v = m.get("latest_version") or {}
    props = (((v.get("openapi_schema") or {}).get("components") or {}).get("schemas") or {}).get("Input", {}).get("properties", {})
    key = next((k for k in IMAGE_KEYS if k in props), "image_input")
    url = data_url(img)
    inp = {key: [url] if props.get(key, {}).get("type") == "array" else url, "prompt": PROMPT}
    for k, val in extra.items():
        if not props or k in props: inp[k] = val
    t0 = time.time()
    p = api(f"/models/{model}/predictions", {"input": inp}, wait=True)
    while p["status"] not in ("succeeded", "failed", "canceled"):
        time.sleep(3); p = api(f"/predictions/{p['id']}")
    if p["status"] != "succeeded": raise RuntimeError(f"{model} {p['status']}: {p.get('error')}")
    out = p["output"]; out = out[-1] if isinstance(out, list) else out
    with urllib.request.urlopen(out, timeout=300) as r: res = Image.open(io.BytesIO(r.read())); res.load()
    return res.convert("RGB"), {"model": model, "id": p["id"], "predict_time": (p.get("metrics") or {}).get("predict_time"),
                                "wall": round(time.time() - t0, 1), "inputs": {k: v for k, v in inp.items() if k not in (key, "prompt")},
                                "in_size": img.size, "out_size": res.size}

# ---------- identity scoring ----------
_fa = None
def faces(img):
    global _fa
    if _fa is None:
        from insightface.app import FaceAnalysis
        _fa = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"]); _fa.prepare(ctx_id=-1, det_size=(1024, 1024))
    return _fa.get(np.asarray(img)[:, :, ::-1])

def identity(orig, res, ref=None):
    """ArcFace cosine of each of the (up to 4) biggest original faces to the nearest face in the result."""
    ref = ref or sorted(faces(orig), key=lambda f: -(f.bbox[2] - f.bbox[0]))[:4]
    r = res.resize(orig.size, Image.LANCZOS) if res.size != orig.size else res
    got = faces(r); scores = []
    for f in ref:
        c = np.array([(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2]); w = f.bbox[2] - f.bbox[0]
        near = [g for g in got if np.linalg.norm(np.array([(g.bbox[0] + g.bbox[2]) / 2, (g.bbox[1] + g.bbox[3]) / 2]) - c) < w * 0.6]
        scores.append(round(float(max((np.dot(f.normed_embedding, g.normed_embedding) for g in near), default=0.0)), 3))
    return scores

# ---------- face-true finish (same idea as engine.js proFinish) ----------
def blur(a, s): return np.asarray(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(s)), dtype=np.float32)

def finish(orig, res, ref):
    """The AI's light and color, the original's own detail inside every face."""
    r = np.asarray(res.resize(orig.size, Image.LANCZOS), dtype=np.float32); o = np.asarray(orig, dtype=np.float32)
    H, W = o.shape[:2]; mask = np.zeros((H, W), np.float32); yy, xx = np.mgrid[0:H, 0:W]
    for f in ref:
        x0, y0, x1, y1 = f.bbox; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 - (y1 - y0) * 0.05; rx, ry = (x1 - x0) * 0.62, (y1 - y0) * 0.72
        d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
        mask = np.maximum(mask, np.clip((1.25 - d) / 0.5, 0, 1))
    if not mask.any(): return res.resize(orig.size, Image.LANCZOS)
    s = max(2.0, float(np.median([f.bbox[2] - f.bbox[0] for f in ref])) / 28)
    out = r + mask[..., None] * ((o - blur(o, s)) - (r - blur(r, s)))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

def save(results, name, img, meta):
    f = f"{name}.jpg"; img.convert("RGB").save(os.path.join(OUT, f), "JPEG", quality=92)
    results[name] = {"file": f, **meta}; print("saved", name, img.size, flush=True)
    json.dump(results, open(os.path.join(OUT, "results.json"), "w"), indent=2, default=str)

if __name__ == "__main__":
    only = sys.argv[1:]
    path = os.path.join(OUT, "results.json")
    results = json.load(open(path)) if os.path.exists(path) else {}
    for photo in ["two", "event", "portrait"]:
        orig = Image.open(os.path.join(HERE, photo + ".jpg")).convert("RGB")
        ref = sorted(faces(orig), key=lambda f: -(f.bbox[2] - f.bbox[0]))[:4]
        print(photo, orig.size, "faces", len(ref), flush=True)
        for name, (model, extra, price, note) in MODELS.items():
            key = f"{photo}__{name}"
            if only and name not in only: continue
            if key in results and "error" not in results[key]: continue
            try:
                img, meta = run(model, orig, extra)
                meta.update(price=price, note=note, identity=identity(orig, img, ref))
                save(results, key, img, meta)
                fin = finish(orig, img, ref)
                save(results, key + "__true", fin, {"from": key, "identity": identity(orig, fin, ref)})
            except Exception as e:
                results[key] = {"error": str(e)[:400]}; print("FAILED", key, e, flush=True)
                json.dump(results, open(path, "w"), indent=2, default=str)
