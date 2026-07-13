// Edge Function: revisa los recordatorios pendientes y envía push notifications.
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

function isDueToday(r: { repeat: string; date: string | null; n: number | null }, todayStr: string) {
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

Deno.serve(async () => {
  const { data: reminders, error } = await supabase
    .from("reminders")
    .select("*, tasks(title, done)");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0;
  const tzCache = new Map<string, { dateStr: string; hh: number; mm: number }>();

  for (const r of reminders ?? []) {
    if (!r.tasks || r.tasks.done) continue;

    if (!tzCache.has(r.timezone)) tzCache.set(r.timezone, nowInTz(r.timezone));
    const local = tzCache.get(r.timezone)!;

    if (r.last_fired_on === local.dateStr) continue; // ya se envió hoy
    if (!isDueToday(r, local.dateStr)) continue;

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
