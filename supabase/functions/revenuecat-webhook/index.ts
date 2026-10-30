// RevenueCat calls this whenever a subscription starts, renews, or ends, and we
// mirror it onto the user's profile. The app logs users into RevenueCat with
// their Supabase user id, so app_user_id is the Supabase user id.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Events that mean the user has Pro until expiration_at_ms. A cancellation still
// has access until then; a refund arrives as a cancellation that ends now.
const ACTIVE = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "CANCELLATION",
  "BILLING_ISSUE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT"]);
const uuids = (list: unknown) => (Array.isArray(list) ? list : []).filter((id) => UUID.test(String(id ?? "")));

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Which plan was bought: the yearly plan has an extra monthly credit cap (migration 007).
const periodOf = (productId?: string) => (/year|annual/i.test(productId ?? "") ? "yearly" : productId ? "weekly" : null);
async function setPlan(ids: string[], plan: "pro" | "free", expires: string | null, period: string | null = null) {
  for (const id of ids) {
    const row: Record<string, unknown> = { id, plan, plan_expires_at: plan === "pro" ? expires : null };
    if (period) row.plan_period = period;
    const { error } = await admin.from("profiles").upsert(row);
    // A user deleted since purchase has no auth row to reference; skip it.
    if (error && !/foreign key/i.test(error.message)) throw error;
  }
}

Deno.serve(async (req) => {
  if (!SECRET || !same(req.headers.get("Authorization") ?? "", `Bearer ${SECRET}`)) return new Response("unauthorized", { status: 401 });
  const { event } = await req.json().catch(() => ({}));
  if (!event) return new Response("bad request", { status: 400 });
  if (Array.isArray(event.entitlement_ids) && !event.entitlement_ids.some((e: string) => e === "pro" || e === "glow_pro")) return new Response("ignored", { status: 200 });

  try {
    if (event.type === "TRANSFER") {
      // "Restore purchases" on a new install moves the subscription to the new account.
      const from = uuids(event.transferred_from), to = uuids(event.transferred_to);
      const { data } = await admin.from("profiles").select("plan, plan_expires_at, plan_period").in("id", from.length ? from : ["00000000-0000-0000-0000-000000000000"])
        .eq("plan", "pro").order("plan_expires_at", { ascending: false }).limit(1);
      const expires = data?.[0]?.plan_expires_at ?? null, period = data?.[0]?.plan_period ?? null;
      if (expires && new Date(expires) > new Date()) { await setPlan(to, "pro", expires, period); await setPlan(from, "free", null); }
      console.log("revenuecat TRANSFER", from.join(","), "->", to.join(","), expires);
      return new Response("ok", { status: 200 });
    }

    const ids = uuids([event.app_user_id, ...(event.aliases ?? [])]);
    if (!ids.length) return new Response("ignored", { status: 200 });
    const expires = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
    if (event.type === "EXPIRATION") await setPlan(ids, "free", null);
    else if (ACTIVE.has(event.type) && expires) await setPlan(ids, "pro", expires, periodOf(event.new_product_id ?? event.product_id));
    else return new Response("ignored", { status: 200 });
    console.log("revenuecat", event.type, ids.join(","), expires);
    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
});
