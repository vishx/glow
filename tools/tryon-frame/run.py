# One-off (2026-11-03): a full-body photo came back cut off at the knees from Try on. Runs the live
# "enhance" function as a fresh anonymous user (3 free premium credits) exactly as the app sends it:
# A) the outfit photo as is (4:5), B) the outfit photo padded to the person photo's shape (2:3),
# C) words only. Saves the AI results and their sizes to out/. Remove when done.
import base64, io, json, os, sys, time, urllib.request, uuid
from PIL import Image

URL = "https://vahtdouihsnpnaskrtka.supabase.co"
KEY = "sb_publishable_UH4edWInYXUknGg_Piqkeg_8fvxPL0b"
D = "tools/tryon-frame/"

def req(method, path, body=None, token=None):
    h = {"apikey": KEY, "Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(URL + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=150) as f: return f.status, json.loads(f.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

def data(im, q=90):
    b = io.BytesIO(); im.save(b, "JPEG", quality=q); return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

person = Image.open(D + "person.jpg").convert("RGB"); person.thumbnail((1536, 1536))
garment = Image.open(D + "garment.jpg").convert("RGB"); garment.thumbnail((1024, 1024))
# B: the garment centered on a plain light card with the person photo's shape.
pw, ph = person.size; gw, gh = garment.size
r = pw / ph
cw, ch = (gw, round(gw / r)) if gw / gh > r else (round(gh * r), gh)
cw, ch = max(cw, gw), max(ch, gh)
card = Image.new("RGB", (cw, ch), (240, 238, 234)); card.paste(garment, ((cw - gw) // 2, (ch - gh) // 2))
card.save(D + "garment-padded.jpg", quality=90)

st, s = req("POST", "/auth/v1/signup", {"data": {}})
token = s.get("access_token"); print("signup", st, bool(token))
cases = [
  ("A-photo-as-is", {"extra": data(garment), "part": "auto"}),
  ("B-photo-padded", {"extra": data(card), "part": "auto"}),
  ("C-words", {"prompt": "a navy blue long-sleeve mini dress with a gold baroque print and tiered ruffle hem", "part": "auto"}),
]
os.makedirs(D + "out", exist_ok=True)
out = {"person": person.size, "garment": garment.size, "padded": card.size}
for name, extra in cases:
    st, r = req("POST", "/functions/v1/enhance", {"image": data(person), "mode": "outfit", "tool": "outfit", "platform": "web", "request_id": str(uuid.uuid4()), **extra}, token)
    print(name, st, r.get("status"), r.get("error"))
    t0 = time.time()
    while st == 200 and r.get("status") not in ("succeeded", "failed", "canceled") and time.time() - t0 < 300:
        time.sleep(4); st, r = req("GET", "/functions/v1/enhance?id=%s" % r["id"], None, token)
    res = {"status": r.get("status"), "error": r.get("error"), "model": r.get("model"), "secs": round(time.time() - t0)}
    o = r.get("output")
    if o:
        o = o[-1] if isinstance(o, list) else o
        with urllib.request.urlopen(o, timeout=150) as f: b = f.read()
        open(D + "out/%s.jpg" % name, "wb").write(b)
        res["size"] = Image.open(io.BytesIO(b)).size
    out[name] = res; print(name, res)
json.dump(out, open(D + "out/results.json", "w"), indent=1)
