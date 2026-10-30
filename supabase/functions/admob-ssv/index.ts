// Google AdMob calls this after a user finishes a rewarded ad (server-side
// verification). We check Google's signature, then record one bonus AI edit.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
// Optional: only accept rewards from our own ad units (comma-separated ids, e.g. "1712485313,5224354917").
const AD_UNITS = (Deno.env.get("ADMOB_AD_UNITS") ?? "").split(",").map((u) => u.trim()).filter(Boolean);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let keys: Record<string, CryptoKey> = {}, keysAt = 0;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function key(id: string) {
  if (!keys[id] && Date.now() - keysAt > 60_000) {
    const { keys: list } = await (await fetch(KEYS_URL)).json();
    keys = {}; keysAt = Date.now();
    for (const k of list) {
      keys[String(k.keyId)] = await crypto.subtle.importKey("spki", b64url(k.base64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
  }
  return keys[id];
}

// Google signs with a DER-encoded ECDSA signature; WebCrypto wants the raw 64-byte r||s form.
function derToRaw(der: Uint8Array) {
  let i = 2; if (der[1] & 0x80) i += der[1] & 0x7f;
  const part = () => { const len = der[i + 1]; const v = der.slice(i + 2, i + 2 + len); i += 2 + len; return v; };
  const fit = (v: Uint8Array) => { const out = new Uint8Array(32); const t = v.slice(Math.max(0, v.length - 32)); out.set(t, 32 - t.length); return out; };
  const r = fit(part()), s = fit(part());
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32); return raw;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const query = url.search.slice(1);
  const cut = query.indexOf("&signature=");
  const sig = url.searchParams.get("signature"), keyId = url.searchParams.get("key_id");
  if (cut < 0 || !sig || !keyId) return new Response("bad request", { status: 400 });

  const k = await key(keyId).catch(() => null);
  if (!k) return new Response("unknown key", { status: 400 });
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, derToRaw(b64url(sig)), new TextEncoder().encode(query.slice(0, cut)));
  if (!ok) return new Response("bad signature", { status: 401 });

  const user = url.searchParams.get("user_id") ?? "", tx = url.searchParams.get("transaction_id") ?? "";
  if (AD_UNITS.length && !AD_UNITS.includes(url.searchParams.get("ad_unit") ?? "")) return new Response("ok", { status: 200 });
  // AdMob's console sends a test call with no real user; it just needs a 200.
  if (UUID.test(user) && tx) {
    const { error } = await admin.from("ad_rewards").insert({ user_id: user, transaction_id: tx });
    if (error && !/duplicate|foreign key/i.test(error.message)) return new Response(error.message, { status: 500 });
    console.log("reward", user, tx, error ? "skipped" : "added");
  }
  return new Response("ok", { status: 200 });
});
