// Edge Function: crea un evento en Google Calendar para cada tarea nueva (con fecha) que
// todavía no se sincronizó. Se dispara por un Cron Job de Supabase cada 5 minutos.
//
// Límite conocido (v1): solo crea eventos para tareas nuevas. Si después editás el título
// u la hora de una tarea ya sincronizada, el evento en Google Calendar no se actualiza solo.
// Si borrás la tarea en Mente, el evento queda en Google Calendar (no se borra solo).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

type TokenRow = {
  user_id: string; refresh_token: string; access_token: string | null;
  access_token_expires_at: string | null; timezone: string;
};

async function refreshAccessToken(row: TokenRow) {
  const stillValid = row.access_token && row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() - Date.now() > 2 * 60 * 1000;
  if (stillValid) return row.access_token as string;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("refresh_failed: " + JSON.stringify(data));

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  await supabase.from("google_tokens").update({
    access_token: data.access_token, access_token_expires_at: expiresAt, updated_at: new Date().toISOString(),
  }).eq("user_id", row.user_id);

  return data.access_token as string;
}

function buildEventPayload(task: { title: string; date: string; time: string | null }, timezone: string) {
  if (task.time) {
    const start = task.date + "T" + task.time + ":00";
    const [hh, mm] = task.time.split(":").map(Number);
    const endDate = new Date(task.date + "T00:00:00");
    endDate.setHours(hh, mm + 30);
    const end = endDate.toISOString().slice(0, 19);
    return {
      summary: task.title,
      start: { dateTime: start, timeZone: timezone },
      end: { dateTime: end, timeZone: timezone },
    };
  }
  const d = new Date(task.date + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return {
    summary: task.title,
    start: { date: task.date },
    end: { date: d.toISOString().slice(0, 10) },
  };
}

Deno.serve(async () => {
  try {
    const { data: tokenRows, error: tokenErr } = await supabase.from("google_tokens").select("*");
    if (tokenErr) return json({ ok: false, error: tokenErr.message }, 500);

    let created = 0;
    for (const row of (tokenRows ?? []) as TokenRow[]) {
      let accessToken: string;
      try {
        accessToken = await refreshAccessToken(row);
      } catch (e) {
        console.error("token refresh failed for user " + row.user_id, e);
        continue;
      }

      const { data: pending } = await supabase
        .from("tasks")
        .select("id, title, date, time")
        .eq("user_id", row.user_id)
        .is("google_event_id", null)
        .not("date", "is", null)
        .eq("done", false);

      for (const task of pending ?? []) {
        try {
          const payload = buildEventPayload(task as { title: string; date: string; time: string | null }, row.timezone);
          const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
            method: "POST",
            headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok && data.id) {
            await supabase.from("tasks").update({ google_event_id: data.id }).eq("id", task.id);
            created++;
          } else {
            console.error("calendar insert failed", data);
          }
        } catch (e) {
          console.error("event create failed for task " + task.id, e);
        }
      }
    }

    return json({ ok: true, created });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
}
