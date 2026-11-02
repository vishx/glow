// TEMPORARY Supabase function "trend-samples" (owner asked for sample pictures on the trend cards,
// 2026-11-02). Lets .github/workflows/trend-samples.yml reach Replicate without the Replicate token
// leaving Supabase: the caller must present a GitHub OIDC token (as the Bearer token) issued to
// vishx/glow on branch claude/project-thread-eunn7r with audience "glow-trend-samples".
// Only model lookups, starting predictions and reading predictions are forwarded.
// Replace with a 410 stub once the samples are made.
import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";

const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const TOKEN = Deno.env.get("REPLICATE_API_TOKEN") ?? "";
const ALLOWED = [/^\/models\/[\w.-]+\/[\w.-]+$/, /^\/models\/[\w.-]+\/[\w.-]+\/predictions$/, /^\/predictions$/, /^\/predictions\/[\w]+$/];

Deno.serve(async (req) => {
  try {
    const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const { payload } = await jwtVerify(auth, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: "glow-trend-samples" });
    if (payload.repository !== "vishx/glow" || payload.ref !== "refs/heads/claude/project-thread-eunn7r") return new Response("Forbidden", { status: 403 });
  } catch { return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }); }
  const path = new URL(req.url).pathname.replace(/^.*\/trend-samples/, "");
  if (!ALLOWED.some((r) => r.test(path))) return new Response("Not allowed", { status: 403 });
  if (req.method === "POST" && !/predictions$/.test(path)) return new Response("Not allowed", { status: 403 });
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const prefer = req.headers.get("prefer"); if (prefer) headers.Prefer = prefer;
  const res = await fetch("https://api.replicate.com/v1" + path, { method: req.method, headers, body: req.method === "POST" ? await req.text() : undefined });
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
});
