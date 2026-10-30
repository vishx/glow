# One-off (approved by the owner on 2026-10-30): remakes the sample's Restore/Enhance and AI
# Retouch previews after those modes moved off CodeFormer. Runs through Glow's live enhance
# function as a fresh anonymous user (2 free daily credits, under 1 cent of Replicate), so the
# results are exactly what users get. Updates public/samples/demo-v2 and its manifest.
import base64, hashlib, io, json, os, time, urllib.request, uuid
from PIL import Image

U = "https://vahtdouihsnpnaskrtka.supabase.co"
K = "sb_publishable_UH4edWInYXUknGg_Piqkeg_8fvxPL0b"
D = "public/samples/demo-v2/"

def req(url, data=None, tok=None):
    h = {"apikey": K, "Content-Type": "application/json"}
    if tok: h["Authorization"] = "Bearer " + tok
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as f: return json.loads(f.read())
    except urllib.error.HTTPError as e: raise SystemExit(f"{url}: {e.code} {e.read()[:300]}")

tok = req(U + "/auth/v1/signup", {"data": {}})["access_token"]
orig = Image.open(D + "original.png").convert("RGB")
buf = io.BytesIO(); orig.save(buf, "JPEG", quality=90)
image = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
m = json.load(open(D + "manifest.json"))

for mode in (os.environ.get("MODES") or "enhance retouch").split():
    t = time.time()
    r = req(U + "/functions/v1/enhance", {"image": image, "mode": mode, "request_id": str(uuid.uuid4())}, tok)
    while r.get("status") not in ("succeeded", "failed", "canceled"):
        if time.time() - t > 300: raise SystemExit(mode + " timed out")
        time.sleep(3); r = req(U + "/functions/v1/enhance?id=" + r["id"], tok=tok)
    if r["status"] != "succeeded": raise SystemExit(f"{mode} {r['status']}: {r.get('error')}")
    raw = Image.open(io.BytesIO(urllib.request.urlopen(r["output"], timeout=120).read())).convert("RGB")
    out = raw.resize(orig.size, Image.LANCZOS)
    out.save(D + mode + ".jpg", quality=92)
    e = next(p for p in m["previews"] if p["tool"] == mode)
    e["provenance"].update({"model": "nightmareai/real-esrgan" if mode == "enhance" else "tencentarc/gfpgan", "version": None,
        "predictionId": r["id"], "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "metrics": {"total_time": round(time.time() - t, 1)},
        "run": "tools/demo/refresh/refresh.py through the live enhance function (v11), GitHub Actions"})
    e.update({"fit": "resized", "rawSize": list(raw.size), "sha256": hashlib.sha256(open(D + mode + ".jpg", "rb").read()).hexdigest(), "assetVersion": 3})
    print(mode, r["id"], raw.size, round(time.time() - t, 1), "s")

json.dump(m, open(D + "manifest.json", "w"), indent=2); open(D + "manifest.json", "a").write("\n")
