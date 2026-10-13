// Edge Function: manda por correo (Resend) el resumen diario de la Bitácora de Pendientes.
// Cada miembro del equipo recibe sus pendientes (donde es responsable): vencidos, para hoy,
// próximos 3 días y los que esperan respuesta. Si no tiene nada, no se le manda correo.
// La dispara el Cron Job "BITACORA_RESUMEN" (ver supabase/migration_resumen_diario.sql).
// Para probar con una sola persona: POST con {"user_id": "..."} y el mismo header x-cron-secret.
// El valor esperado de x-cron-secret vive en public.app_settings (key = digest_cron_secret), sin acceso desde el navegador.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("DIGEST_FROM") ?? "Bitácora de Pendientes <no-reply@creditossdb.com.mx>";
const APP_URL = "https://mente-teal.vercel.app/pendientes.html";
const TZ = "America/Mexico_City";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const PRI: Record<string, { l: string; r: number; c: string }> = {
  urgente: { l: "Urgente", r: 0, c: "#ff3b30" },
  alta: { l: "Alta", r: 1, c: "#ff9500" },
  media: { l: "Media", r: 2, c: "#007aff" },
  baja: { l: "Baja", r: 3, c: "#8e8e93" },
};
const STATUS: Record<string, string> = { pendiente: "Pendiente", proceso: "En proceso", espera: "En espera de respuesta", hecho: "Terminado" };
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type Item = {
  id: string; title: string; requester_name: string; deadline: string | null;
  priority: string; status: string; owner_id: string | null;
};

function todayInTz() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const toDate = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const diffDays = (s: string, today: string) => Math.round((toDate(s).getTime() - toDate(today).getTime()) / 86400000);
const fmtShort = (s: string) => { const d = toDate(s); return `${DIA[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MES[d.getUTCMonth()]}`; };
const fmtLong = (s: string) => { const d = toDate(s); return `${DIA[d.getUTCDay()]} ${d.getUTCDate()} de ${MESL[d.getUTCMonth()]}`; };
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const byPri = (a: Item, b: Item) => (PRI[a.priority]?.r ?? 2) - (PRI[b.priority]?.r ?? 2) || (a.deadline ?? "9").localeCompare(b.deadline ?? "9");

function itemRow(it: Item, today: string, dueColor: string) {
  const p = PRI[it.priority] ?? PRI.media;
  let due = "";
  if (it.deadline) {
    const n = diffDays(it.deadline, today);
    due = n < 0 ? `Vencido hace ${-n} d${-n === 1 ? "ía" : "ías"}` : n === 0 ? "Vence hoy" : n === 1 ? "Mañana" : fmtShort(it.deadline);
  }
  const meta = [it.requester_name ? `Solicitó ${esc(it.requester_name)}` : "", esc(STATUS[it.status] ?? "")].filter(Boolean).join(" · ");
  return `<tr><td style="padding:12px 16px;border-top:1px solid #e5e5ea">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td width="18" valign="top" style="padding-top:5px"><div style="width:10px;height:10px;border-radius:5px;background:${p.c}"></div></td>
      <td valign="top">
        <div style="font-size:15px;font-weight:600;color:#1c1c1e;line-height:1.35">${esc(it.title)}</div>
        <div style="font-size:13px;color:#6e6e73;margin-top:2px">${meta}</div>
      </td>
      <td valign="top" align="right" style="white-space:nowrap;padding-left:12px">
        <div style="font-size:13px;font-weight:600;color:${dueColor}">${esc(due)}</div>
        <div style="font-size:12px;color:${p.c};margin-top:2px">${p.l}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function section(title: string, color: string, items: Item[], today: string, dueColor: string) {
  if (!items.length) return "";
  return `<tr><td style="padding:22px 4px 8px;font-size:19px;font-weight:700;color:${color};letter-spacing:-0.3px">${title} <span style="color:#8e8e93;font-weight:500;font-size:15px">${items.length}</span></td></tr>
  <tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:14px;overflow:hidden">
    ${items.map((it) => itemRow(it, today, dueColor)).join("").replace('border-top:1px solid #e5e5ea', 'border-top:0')}
  </table></td></tr>`;
}

function buildEmail(name: string, today: string, g: { late: Item[]; now: Item[]; next: Item[]; wait: Item[] }) {
  const hola = name ? `Hola ${esc(name.split(/\s+/)[0])},` : "Hola,";
  const counts = [
    g.now.length ? `${g.now.length} para hoy` : "",
    g.late.length ? `${g.late.length} vencido${g.late.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  const subject = counts.length ? `Tus pendientes de hoy: ${counts.join(", ")}` : `Tus pendientes: ${fmtLong(today)}`;
  const intro = counts.length
    ? `Hoy tienes ${counts.join(" y ")}.`
    : "Hoy no tienes nada que venza. Esto es lo que viene y lo que espera respuesta.";
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f7"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
    <tr><td style="padding:0 4px">
      <div style="font-size:13px;color:#6e6e73;text-transform:capitalize">${fmtLong(today)}</div>
      <div style="font-size:26px;font-weight:700;color:#1c1c1e;letter-spacing:-0.6px;margin-top:2px">${hola}</div>
      <div style="font-size:15px;color:#3a3a3c;margin-top:6px">${intro}</div>
    </td></tr>
    ${section("Vencidos", "#ff3b30", g.late, today, "#ff3b30")}
    ${section("Para hoy", "#ff9500", g.now, today, "#ff9500")}
    ${section("Próximos 3 días", "#007aff", g.next, today, "#6e6e73")}
    ${section("Esperando respuesta", "#5856d6", g.wait, today, "#6e6e73")}
    <tr><td align="center" style="padding:26px 4px 8px">
      <a href="${APP_URL}" style="display:inline-block;background:#007aff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:999px">Abrir la Bitácora</a>
    </td></tr>
    <tr><td align="center" style="padding:10px 4px;font-size:12px;color:#8e8e93">Recibes este resumen porque eres responsable de estos pendientes. Puedes apagarlo en la Bitácora, botón Equipo.</td></tr>
  </table></td></tr></table></body></html>`;
  const lines = (t: string, xs: Item[]) => xs.length ? `\n${t}\n${xs.map((x) => `- ${x.title}${x.deadline ? ` (${fmtShort(x.deadline)})` : ""}`).join("\n")}\n` : "";
  const text = `${hola}\n\n${intro}\n${lines("VENCIDOS", g.late)}${lines("PARA HOY", g.now)}${lines("PRÓXIMOS 3 DÍAS", g.next)}${lines("ESPERANDO RESPUESTA", g.wait)}\nAbrir la Bitácora: ${APP_URL}`;
  return { subject, html, text };
}

Deno.serve(async (req) => {
  const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "digest_cron_secret").maybeSingle();
  if (!setting?.value || req.headers.get("x-cron-secret") !== setting.value) return new Response("No autorizado", { status: 401 });
  if (!RESEND_API_KEY) return new Response("Falta el secret RESEND_API_KEY", { status: 500 });

  let only: string | null = null;
  try { only = (await req.json())?.user_id ?? null; } catch { /* sin cuerpo: todos */ }

  const today = todayInTz();
  const [team, people, items] = await Promise.all([
    supabase.from("team_members").select("user_id"),
    supabase.from("profiles").select("id,email,full_name,daily_digest"),
    supabase.from("work_items").select("id,title,requester_name,deadline,priority,status,owner_id").neq("status", "hecho"),
  ]);
  if (team.error || people.error || items.error) {
    console.error(team.error ?? people.error ?? items.error);
    return new Response("Error al leer datos", { status: 500 });
  }

  const results: Record<string, string> = {};
  for (const { user_id } of team.data) {
    if (only && user_id !== only) continue;
    const p = people.data.find((x) => x.id === user_id);
    if (!p?.email) { results[user_id] = "sin correo"; continue; }
    if (!only && p.daily_digest === false) { results[p.email] = "apagado"; continue; }
    const mine = (items.data as Item[]).filter((it) => it.owner_id === user_id);
    const g = {
      late: mine.filter((it) => it.deadline && diffDays(it.deadline, today) < 0).sort(byPri),
      now: mine.filter((it) => it.deadline && diffDays(it.deadline, today) === 0).sort(byPri),
      next: mine.filter((it) => it.deadline && diffDays(it.deadline, today) >= 1 && diffDays(it.deadline, today) <= 3).sort(byPri),
      wait: mine.filter((it) => it.status === "espera" && !(it.deadline && diffDays(it.deadline, today) <= 3)).sort(byPri),
    };
    if (!g.late.length && !g.now.length && !g.next.length && !g.wait.length) { results[p.email] = "nada pendiente"; continue; }
    const mail = buildEmail(p.full_name, today, g);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [p.email], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    results[p.email] = r.ok ? "enviado" : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
  }
  console.log(JSON.stringify({ today, results }));
  return new Response(JSON.stringify({ today, results }), { headers: { "Content-Type": "application/json" } });
});
