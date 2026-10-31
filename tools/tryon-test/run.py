# One-off end-to-end check of Try on (2026-10-31 audit): signs in as a fresh anonymous user (3 free
# premium credits), runs one idea, one description and one outfit photo through the preview server
# enhance-tryon exactly as the app sends them, and saves the AI results to out/. Remove when done.
import base64, io, json, sys, time, urllib.request
from PIL import Image

URL = "https://vahtdouihsnpnaskrtka.supabase.co"
KEY = "sb_publishable_UH4edWInYXUknGg_Piqkeg_8fvxPL0b"
FN = sys.argv[1] if len(sys.argv) > 1 else "enhance-tryon"

def req(method, path, body=None, token=None):
    h = {"apikey": KEY, "Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(URL + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=120) as f: return f.status, json.loads(f.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

def jpeg(path, side):
    im = Image.open(path).convert("RGB"); im.thumbnail((side, side))
    b = io.BytesIO(); im.save(b, "JPEG", quality=90); return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

st, s = req("POST", "/auth/v1/signup", {"data": {}})
token = s.get("access_token"); print("signup", st, bool(token))
person = jpeg("public/samples/demo-v2/original.png", 1600)
cases = [
  ("idea-leather", {"prompt": "a black leather biker jacket over a plain T-shirt, mainly in black", "part": "top"}),
  ("words-red-dress", {"prompt": "a red satin slip dress", "part": "auto"}),
  ("photo-suit", {"extra": jpeg("public/samples/demo-v2/suit.jpg", 1024), "part": "auto"}),
]
out = {}
for name, extra in cases:
    import uuid
    st, r = req("POST", "/functions/v1/" + FN, {"image": person, "mode": "outfit", "tool": "outfit", "platform": "web", "request_id": str(uuid.uuid4()), **extra}, token)
    print(name, st, r.get("status"), r.get("error"))
    t0 = time.time()
    while st == 200 and r.get("status") not in ("succeeded", "failed", "canceled") and time.time() - t0 < 240:
        time.sleep(4); st, r = req("GET", "/functions/v1/%s?id=%s" % (FN, r["id"]), None, token)
    out[name] = {"status": r.get("status"), "error": r.get("error"), "secs": round(time.time() - t0)}
    o = r.get("output")
    if o:
        o = o[-1] if isinstance(o, list) else o
        with urllib.request.urlopen(o, timeout=120) as f: open("tools/tryon-test/out/%s.jpg" % name, "wb").write(f.read())
    print(name, out[name])
json.dump(out, open("tools/tryon-test/out/results.json", "w"), indent=1)
