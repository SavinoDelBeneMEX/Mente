// Edge Function: adelanta las tareas recurrentes que falten y envía push notifications.
// Se dispara por un Cron Job de Supabase cada 1 minuto (ver README.md).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:soporte@mente.app", VAPID_PUBLIC, VAPID_PRIVATE);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function nowInTz(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { dateStr: `${get("year")}-${get("month")}-${get("day")}`, hh: Number(get("hour")), mm: Number(get("minute")) };
}

// ---------- recordatorios (reminders.repeat es un string: once | daily | weekdays | every) ----------
function reminderIsDueToday(r: { repeat: string; date: string | null; n: number | null }, todayStr: string) {
  if (r.repeat === "daily") return true;
  if (r.repeat === "weekdays") {
    const dow = new Date(todayStr + "T00:00:00Z").getUTCDay();
    return dow >= 1 && dow <= 5;
  }
  if (r.repeat === "every") {
    if (!r.date) return false;
    const start = new Date(r.date + "T00:00:00Z").getTime();
    const today0 = new Date(todayStr + "T00:00:00Z").getTime();
    const diffDays = Math.round((today0 - start) / 86400000);
    return diffDays >= 0 && diffDays % (r.n || 1) === 0;
  }
  return r.date === todayStr; // once
}

// ---------- tareas recurrentes (tasks.repeat es jsonb: {type, n?}) ----------
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function nextTaskRepeatDate(dateStr: string, repeat: { type: string; n?: number }) {
  if (!repeat) return null;
  if (repeat.type === "daily") return addDays(dateStr, 1);
  if (repeat.type === "every") return addDays(dateStr, repeat.n || 1);
  if (repeat.type === "weekdays") {
    let d = new Date(dateStr + "T00:00:00Z");
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

type TaskRow = {
  id: string; series_id: string; date: string; time: string | null; title: string;
  priority: string; category: string; repeat: { type: string; n?: number }; subtasks: { title: string }[];
  user_id: string;
};

async function ensureRecurringOccurrences() {
  const { data: rows } = await supabase
    .from("tasks")
    .select("id, series_id, date, time, title, priority, category, repeat, subtasks, user_id")
    .not("series_id", "is", null)
    .not("repeat", "is", null)
    .not("date", "is", null)
    .order("date", { ascending: false });

  const latestBySeries = new Map<string, TaskRow>();
  for (const t of (rows ?? []) as TaskRow[]) {
    if (!latestBySeries.has(t.series_id)) latestBySeries.set(t.series_id, t);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const horizonStr = addDays(todayStr, 60); // genera ocurrencias hasta 60 días adelante, no solo la de hoy

  for (const [seriesId, latest] of latestBySeries) {
    let cursor = latest.date;
    let guard = 0;
    while (guard++ < 400) {
      const next = nextTaskRepeatDate(cursor, latest.repeat);
      if (!next || next > horizonStr) break;

      const { data: exists } = await supabase
        .from("tasks").select("id").eq("series_id", seriesId).eq("date", next).maybeSingle();

      if (!exists) {
        await supabase.from("tasks").insert({
          user_id: latest.user_id, title: latest.title, date: next, time: latest.time,
          priority: latest.priority, category: latest.category, star: false, done: false,
          repeat: latest.repeat, series_id: seriesId,
          subtasks: (latest.subtasks || []).map((s) => ({ id: crypto.randomUUID(), title: s.title, done: false })),
        });
      }
      cursor = next;
    }
  }
}

Deno.serve(async () => {
  await ensureRecurringOccurrences();

  const { data: reminders, error } = await supabase
    .from("reminders")
    .select("*, tasks(title, done)");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0;
  const tzCache = new Map<string, { dateStr: string; hh: number; mm: number }>();

  for (const r of reminders ?? []) {
    if (!r.tasks) continue;
    // Un recordatorio "una vez" se cancela si esa tarea puntual ya se completó.
    // Uno recurrente (diario / días hábiles / cada X días) suena siempre según el horario,
    // sin importar si la ocurrencia de hoy ya quedó marcada como hecha.
    if (r.repeat === "once" && r.tasks.done) continue;

    if (!tzCache.has(r.timezone)) tzCache.set(r.timezone, nowInTz(r.timezone));
    const local = tzCache.get(r.timezone)!;

    if (r.last_fired_on === local.dateStr) continue; // ya se envió hoy
    if (!reminderIsDueToday(r, local.dateStr)) continue;

    const [rh, rm] = r.time.split(":").map(Number);
    const dueMinutes = rh * 60 + rm;
    const nowMinutes = local.hh * 60 + local.mm;
    if (Math.abs(nowMinutes - dueMinutes) > 1) continue;

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", r.user_id);

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: "Mente — recordatorio", body: r.tasks.title })
        );
        sent++;
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }

    await supabase.from("reminders").update({ last_fired_on: local.dateStr }).eq("id", r.id);
  }

  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
