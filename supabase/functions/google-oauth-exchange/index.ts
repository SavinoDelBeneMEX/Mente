// Edge Function: recibe el "code" de OAuth de Google y lo cambia por un access_token +
// refresh_token, que guarda para ese usuario. La llama el frontend justo después de que
// Google redirige de vuelta a la app.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  try {
    var authHeader = req.headers.get("Authorization") || "";
    var jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "missing_auth" }, 401);

    var userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: "Bearer " + jwt } },
    });
    var userRes = await userClient.auth.getUser(jwt);
    if (userRes.error || !userRes.data.user) return json({ ok: false, error: "invalid_session" }, 401);
    var userId = userRes.data.user.id;

    var body = await req.json();
    var code = body.code;
    var redirectUri = body.redirect_uri;
    var timezone = body.timezone || "UTC";
    if (!code || !redirectUri) return json({ ok: false, error: "missing_code_or_redirect" }, 400);

    var tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    var tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.refresh_token) {
      return json({ ok: false, error: "google_exchange_failed", detail: tokenData }, 400);
    }

    var expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

    var { error } = await adminClient.from("google_tokens").upsert({
      user_id: userId,
      refresh_token: tokenData.refresh_token,
      access_token: tokenData.access_token,
      access_token_expires_at: expiresAt,
      timezone: timezone,
      updated_at: new Date().toISOString(),
    });
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
}
