// Edge Function pública (sin login): permite que la persona a la que le pides confirmar
// una tarea vea su título/foto y la marque como hecha, solo con el token que va en el link
// que le mandas por WhatsApp. Usa la service role key para saltarse RLS de forma controlada
// (nunca expone la tabla completa, solo la fila que coincide con ese token puntual).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TASK_FIELDS = "id, title, category, notes, photos, confirm_person, confirmed_at, confirmed_by, requires_confirmation";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    var url = new URL(req.url);
    var token = req.method === "GET" ? url.searchParams.get("token") : null;

    if (req.method === "GET") {
      if (!token) return json({ ok: false, error: "missing_token" }, 400);
      var res = await supabase.from("tasks").select(TASK_FIELDS)
        .eq("confirmation_token", token).eq("requires_confirmation", true).maybeSingle();
      if (res.error) return json({ ok: false, error: "internal_error" }, 500);
      if (!res.data) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, task: res.data });
    }

    if (req.method === "POST") {
      var body = await req.json().catch(function () { return {}; });
      token = body.token;
      var confirmedBy = (body.name || "").toString().slice(0, 80) || null;
      if (!token) return json({ ok: false, error: "missing_token" }, 400);

      var existing = await supabase.from("tasks").select(TASK_FIELDS)
        .eq("confirmation_token", token).eq("requires_confirmation", true).maybeSingle();
      if (existing.error) return json({ ok: false, error: "internal_error" }, 500);
      if (!existing.data) return json({ ok: false, error: "not_found" }, 404);

      if (existing.data.confirmed_at) {
        // ya estaba confirmada: idempotente, no la vuelve a tocar.
        return json({ ok: true, task: existing.data, already: true });
      }

      var updated = await supabase.from("tasks")
        .update({ done: true, confirmed_at: new Date().toISOString(), confirmed_by: confirmedBy })
        .eq("confirmation_token", token)
        .select(TASK_FIELDS).single();
      if (updated.error) return json({ ok: false, error: "internal_error" }, 500);

      return json({ ok: true, task: updated.data });
    }

    return json({ ok: false, error: "method_not_allowed" }, 405);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
