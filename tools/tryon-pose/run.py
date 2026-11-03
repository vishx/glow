# One-off (2026-11-03): re-pose each Try on outfit photo to suit its clothes (owner: "the stance
# should match the cloth"). Runs the live "enhance" custom edit as fresh anonymous users, one at a
# time (Replicate throttles parallel jobs). Remove when done.
import base64, io, json, os, time, urllib.request, uuid
from PIL import Image
URL = "https://vahtdouihsnpnaskrtka.supabase.co"; KEY = "sb_publishable_UH4edWInYXUknGg_Piqkeg_8fvxPL0b"
D = "tools/tryon-pose/"
POSE = {
 "suit": "confident stance, one hand in her trouser pocket, weight on one leg",
 "sundress": "relaxed, body turned slightly, one hand lightly holding the skirt",
 "lbd": "elegant three-quarter turn, one hand on her hip",
 "leather": "cool relaxed stance, both hands in the jacket pockets",
 "blazer": "confident, slight turn, one hand in her pocket",
 "gown": "graceful three-quarter turn, one foot forward, arms relaxed",
 "street": "casual relaxed stance, hands in the bomber jacket pockets",
 "denim": "relaxed, thumbs hooked in her jeans pockets",
 "trench": "walking mid-stride toward the camera, hands in the coat pockets",
 "guest": "elegant, slight turn, hands lightly clasped in front",
 "maxi": "graceful slight turn, one hand touching her hair",
 "shirtdress": "relaxed, one hand resting on the belted waist",
 "knitdress": "cozy relaxed stance, arms loosely crossed",
 "sequin": "party pose, one hand on her hip, slight turn",
 "oxford": "smart relaxed stance, one hand in her trouser pocket",
 "tux": "confident stance, both hands in her trouser pockets",
 "casual": "relaxed, thumbs in her jeans pockets, weight on one leg",
 "linen": "relaxed, walking mid-stride",
 "hoodie": "relaxed, both hands in the hoodie front pocket",
 "polo": "relaxed, one hand in her chino pocket",
 "knit": "cozy, sleeves pulled over her hands near her chest",
 "coat": "walking mid-stride, coat swinging open",
 "puffer": "hands in the puffer jacket pockets, shoulders slightly raised",
 "sporty": "sporty relaxed stance, one hand on her hip",
 "varsity": "casual, hands in the varsity jacket pockets",
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
for i, pose in POSE.items():
    if (only and i not in only) or os.path.exists(D + "out/%s.jpg" % i): continue
    img = Image.open(D + "in/%s.jpg" % i).convert("RGB")
    prompt = "change only her pose: %s. Keep the exact same outfit, face, hair, beige backdrop and full-body framing head to toe" % pose
    r = {}
    for attempt in range(4):
        st, s = req("POST", "/auth/v1/signup", {"data": {}}); token = s.get("access_token")
        if not token: print(i, "signup", st, s); time.sleep(30); continue
        st, r = req("POST", "/functions/v1/enhance", {"image": data(img), "mode": "custom", "prompt": prompt[:200], "platform": "web", "request_id": str(uuid.uuid4())}, token)
        t0 = time.time()
        while st == 200 and r.get("status") not in ("succeeded", "failed", "canceled") and time.time() - t0 < 300:
            time.sleep(4); st, r = req("GET", "/functions/v1/enhance?id=%s" % r["id"], None, token)
        o = r.get("output")
        if o:
            o = o[-1] if isinstance(o, list) else o
            with urllib.request.urlopen(o, timeout=150) as f: open(D + "out/%s.jpg" % i, "wb").write(f.read())
            break
        print(i, st, r.get("status"), r.get("error")); time.sleep(15)
    res[i] = "ok" if os.path.exists(D + "out/%s.jpg" % i) else (r.get("error") if isinstance(r, dict) else "failed")
    print(i, res[i], flush=True)
json.dump(res, open(D + "out/results-%d.json" % time.time(), "w"), indent=1)
