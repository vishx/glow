# One-off (2026-11-03): real checks of Try on shoes (matching shoes, shoes only) that also make the
# Shoes row photos. Runs the live "enhance" Try on (outfit mode) as fresh anonymous users, one at a
# time (Replicate throttles parallel jobs). Remove when done.
import base64, io, json, os, time, urllib.request, uuid
from PIL import Image
URL = "https://vahtdouihsnpnaskrtka.supabase.co"; KEY = "sb_publishable_UH4edWInYXUknGg_Piqkeg_8fvxPL0b"
D = "tools/tryon-shoes/"
JOBS = {
 "shoe-heels": "elegant high heels instead of the current shoes, keeping the clothes exactly as they are",
 "shoe-flats": "ballet flats instead of the current shoes, keeping the clothes exactly as they are",
 "shoe-loafers": "leather loafers instead of the current shoes, keeping the clothes exactly as they are",
 "shoe-sneakers": "clean white sneakers instead of the current shoes, keeping the clothes exactly as they are",
 "shoe-boots": "leather ankle boots instead of the current shoes, keeping the clothes exactly as they are",
 "shoe-sandals": "strappy sandals instead of the current shoes, keeping the clothes exactly as they are",
 "match-gown": "an elegant floor-length evening gown, with elegant strappy heels",
 "match-suit": "a sharp, tailored business suit with a crisp shirt, with sleek black leather shoes",
}
def req(method, path, body=None, token=None):
    h = {"apikey": KEY, "Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(URL + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=150) as f: return f.status, json.loads(f.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def data(im):
    b = io.BytesIO(); im.save(b, "JPEG", quality=90); return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()
os.makedirs(D + "out", exist_ok=True)
only = [w for w in open(D + "trigger.txt").read().split() if not w.isdigit()]
res = {}
img = Image.open(D + "base.jpg").convert("RGB")
for i, prompt in JOBS.items():
    if (only and i not in only) or os.path.exists(D + "out/%s.jpg" % i): continue
    r = {}
    for attempt in range(4):
        st, s = req("POST", "/auth/v1/signup", {"data": {}}); token = s.get("access_token")
        if not token: print(i, "signup", st, s); time.sleep(30); continue
        st, r = req("POST", "/functions/v1/enhance", {"image": data(img), "mode": "outfit", "tool": "outfit", "prompt": prompt, "part": "auto", "platform": "web", "request_id": str(uuid.uuid4())}, token)
        t0 = time.time()
        while st == 200 and r.get("status") not in ("succeeded", "failed", "canceled") and time.time() - t0 < 300:
            time.sleep(4); st, r = req("GET", "/functions/v1/enhance?id=%s" % r["id"], None, token)
        o = r.get("output")
        if o:
            o = o[-1] if isinstance(o, list) else o
            with urllib.request.urlopen(o, timeout=150) as f: open(D + "out/%s.jpg" % i, "wb").write(f.read())
            break
        print(i, st, r.get("status"), r.get("error")); time.sleep(15)
        if "paused here" in str(r.get("error")): break
    res[i] = "ok" if os.path.exists(D + "out/%s.jpg" % i) else (r.get("error") if isinstance(r, dict) else "failed")
    print(i, res[i], flush=True)
json.dump(res, open(D + "out/results-%d.json" % time.time(), "w"), indent=1)
