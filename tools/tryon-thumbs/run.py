# One-off (2026-11-03): real photos for the Try on outfit row. Runs the live "enhance" function as
# fresh anonymous users (3 free credits each), one account per job. Stage "base": make a full-body
# photo of the sample model. Stage "outfits": dress that base photo in every outfit from tryon.js.
# Remove when done.
import base64, io, json, os, re, sys, time, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
URL = "https://vahtdouihsnpnaskrtka.supabase.co"; KEY = "sb_publishable_UH4edWInYXUknGg_Piqkeg_8fvxPL0b"
D = "tools/tryon-thumbs/"
def req(method, path, body=None, token=None):
    h = {"apikey": KEY, "Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(URL + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=150) as f: return f.status, json.loads(f.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def data(im, q=90):
    b = io.BytesIO(); im.save(b, "JPEG", quality=q); return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()
def run(name, img, body):
    for attempt in range(4):
        st, s = req("POST", "/auth/v1/signup", {"data": {}}); token = s.get("access_token")
        if not token: print(name, "signup", st, s); time.sleep(20); continue
        st, r = req("POST", "/functions/v1/enhance", {"image": data(img), "platform": "web", "request_id": str(uuid.uuid4()), **body}, token)
        t0 = time.time()
        while st == 200 and r.get("status") not in ("succeeded", "failed", "canceled") and time.time() - t0 < 300:
            time.sleep(4); st, r = req("GET", "/functions/v1/enhance?id=%s" % r["id"], None, token)
        o = r.get("output")
        if o:
            o = o[-1] if isinstance(o, list) else o
            with urllib.request.urlopen(o, timeout=150) as f: open(D + "out/%s.jpg" % name, "wb").write(f.read())
            return {"status": "ok", "secs": round(time.time() - t0)}
        print(name, st, r.get("status"), r.get("error")); time.sleep(15)
    return {"status": "failed", "error": r.get("error") if isinstance(r, dict) else None}
os.makedirs(D + "out", exist_ok=True)
stage = open(D + "trigger.txt").read().split()[0]
res = {}
if stage == "base":
    pad = Image.open(D + "base-pad.jpg").convert("RGB")
    jobs = [
      ("base-1", pad, {"mode": "custom", "prompt": "fill the blank area so she is shown full body head to toe, standing relaxed facing camera, plain white top, blue jeans, white sneakers, same beige studio wall and floor"}),
      ("base-2", pad, {"mode": "custom", "prompt": "turn this into a full-length fashion photo of her standing, whole body head to feet in frame, fitted white tee, straight blue jeans, white sneakers, plain beige studio"}),
    ]
else:
    base = Image.open(D + "base.jpg").convert("RGB")
    src = open("public/tryon.js").read()
    outfits = re.findall(r'^  \["(\w+)", "[^"]*", "([^"]*)", "(\w+)"', src, re.M)
    only = [w for w in open(D + "trigger.txt").read().split()[1:] if not w.isdigit()]
    jobs = [(i, base, {"mode": "outfit", "tool": "outfit", "prompt": w, "part": p}) for i, w, p in outfits if not only or i in only]
with ThreadPoolExecutor(1) as ex:
    for (n, *_), r in zip(jobs, ex.map(lambda j: run(*j), jobs)): res[n] = r; print(n, r)
json.dump(res, open(D + "out/results-%s-%d.json" % (stage, time.time()), "w"), indent=1)
