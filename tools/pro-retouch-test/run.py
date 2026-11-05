import json, base64, sys, time, urllib.request
U="https://vahtdouihsnpnaskrtka.supabase.co"; K=__import__("os").environ["SB_ANON"]
def req(url, data=None, tok=None, method=None):
    h={"apikey":K,"Content-Type":"application/json"}
    if tok: h["Authorization"]="Bearer "+tok
    r=urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=150) as f: return json.loads(f.read())
    except urllib.error.HTTPError as e: return {"http":e.code,"body":e.read().decode()[:500]}
if sys.argv[1]=="signup":
    d=req(U+"/auth/v1/signup",{"data":{"test":"pro-retouch"}})
    open('tok','w').write(d.get("access_token","")); print(d.get("user",{}).get("id"), d.get("msg") or d.get("http"))
else:
    tok=open('tok').read()
    b64=lambda f: "data:image/jpeg;base64,"+base64.b64encode(open(f,'rb').read()).decode()
    import uuid
    t0=time.time()
    d=req(U+"/functions/v1/enhance-next",{"image":b64('sheet.jpg'),"mode":"pro","from":"enhance","platform":"web","request_id":str(uuid.uuid4()),"faces":b64('sheet.jpg'),"retouch":1},tok)
    print(json.dumps(d)[:400])
    pid=d.get("id")
    while pid and d.get("status") not in ("succeeded","failed","canceled") or (d.get("status")=="succeeded" and False):
        time.sleep(3); d=req(U+"/functions/v1/enhance-next?id="+urllib.parse.quote(pid),None,tok)
        print(round(time.time()-t0), d.get("status"))
    print(json.dumps(d)[:800])
    for k in ("retouch",):
        u=d.get(k)
        if isinstance(u,list): u=u[0]
        if u: urllib.request.urlretrieve(u, k+".img"); print("saved",k); from PIL import Image; Image.open(k+".img").convert("RGB").resize((448,448)).save(k+".jpg",quality=80)
    print("secs", round(time.time()-t0))
