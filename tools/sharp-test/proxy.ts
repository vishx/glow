// TEMPORARY Supabase function "sharp-test" (owner approved the sharpness test on 2026-10-31).
// Lets the GitHub workflow .github/workflows/sharp-test.yml reach Replicate without the
// Replicate token ever leaving Supabase: the caller must present a GitHub OIDC token issued to
// vishx/glow on branch claude/project-thread-mg0015 with audience "glow-sharp-test".
// Only model lookups, starting predictions and reading predictions are forwarded.
// Replace with a 410 stub (or delete) once the test is done.
import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";

const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const TOKEN = Deno.env.get("REPLICATE_API_TOKEN") ?? "";
const ALLOWED = [/^\/models\/[\w.-]+\/[\w.-]+$/, /^\/models\/[\w.-]+\/[\w.-]+\/predictions$/, /^\/predictions$/, /^\/predictions\/[\w]+$/];

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("x-gh-oidc") ?? "";
    const { payload } = await jwtVerify(auth, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: "glow-sharp-test" });
    if (payload.repository !== "vishx/glow" || payload.ref !== "refs/heads/claude/project-thread-mg0015") return new Response("Forbidden", { status: 403 });
  } catch { return new Response("Unauthorized", { status: 401 }); }
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/sharp-test/, "");
  if (!ALLOWED.some((r) => r.test(path))) return new Response("Not allowed", { status: 403 });
  if (req.method === "POST" && !/predictions$/.test(path)) return new Response("Not allowed", { status: 403 });
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const prefer = req.headers.get("prefer"); if (prefer) headers.Prefer = prefer;
  const res = await fetch("https://api.replicate.com/v1" + path, { method: req.method, headers, body: req.method === "POST" ? await req.text() : undefined });
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
});
