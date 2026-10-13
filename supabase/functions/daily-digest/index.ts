// Edge Function: manda por correo (Resend) el resumen diario de Backbrain.
// Cada miembro del equipo recibe sus pendientes (donde es responsable): vencidos, para hoy,
// próximos 3 días y los que esperan respuesta. Si no tiene nada, no se le manda correo.
// La dispara el Cron Job "BITACORA_RESUMEN" (ver supabase/migration_resumen_diario.sql).
// Con {"mode":"weekly"} (Cron "BACKBRAIN_SEMANAL", lunes) manda el resumen del equipo a quien tenga
// profiles.weekly_summary = true.
// Para probar con una sola persona: POST con {"user_id": "..."} y el mismo header x-cron-secret.
// El valor esperado de x-cron-secret vive en public.app_settings (key = digest_cron_secret), sin acceso desde el navegador.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("DIGEST_FROM") ?? "Backbrain <no-reply@creditossdb.com.mx>";
const APP_URL = "https://mente-teal.vercel.app/backbrain";
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
  id: string; title: string; requester_name: string; client: string; deadline: string | null;
  priority: string; status: string; owner_id: string | null;
  stage: string | null; stage_changed_at: string | null; completed_at?: string | null;
};
const STAGE: Record<string, string> = { inicio: "Por iniciar", revision: "Revisión", firma: "Firma", cliente: "Enviado al cliente", proveedor: "Enviado a proveedor" };
// Días en una misma etapa a partir de los cuales el pendiente se marca como atorado (igual que en pendientes.html)
const STUCK_DAYS: Record<string, number> = { inicio: 7, revision: 3, firma: 3, cliente: 5, proveedor: 5 };
const isoDayInTz = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
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
const daysInStage = (it: Item, today: string) => it.stage && it.stage_changed_at ? diffDays(today, isoDayInTz(it.stage_changed_at)) : 0;
const isStuck = (it: Item, today: string) => !!it.stage && daysInStage(it, today) >= (STUCK_DAYS[it.stage] ?? 99);
const byPri = (a: Item, b: Item) => (PRI[a.priority]?.r ?? 2) - (PRI[b.priority]?.r ?? 2) || (a.deadline ?? "9").localeCompare(b.deadline ?? "9");

function itemRow(it: Item, today: string, dueColor: string) {
  const p = PRI[it.priority] ?? PRI.media;
  let due = "";
  if (it.deadline) {
    const n = diffDays(it.deadline, today);
    due = n < 0 ? `Vencido hace ${-n} d${-n === 1 ? "ía" : "ías"}` : n === 0 ? "Vence hoy" : n === 1 ? "Mañana" : fmtShort(it.deadline);
  }
  const stageTxt = it.stage && STAGE[it.stage] ? `${STAGE[it.stage]}${it.stage_changed_at ? ` (${daysInStage(it, today)} d)` : ""}` : "";
  const meta = [it.client ? esc(it.client) : "", it.requester_name ? `Solicitó ${esc(it.requester_name)}` : "", stageTxt ? esc(stageTxt) : esc(STATUS[it.status] ?? "")].filter(Boolean).join(" · ");
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

function buildEmail(name: string, today: string, g: { late: Item[]; now: Item[]; next: Item[]; wait: Item[]; stuck: Item[] }) {
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
    ${section("Necesita seguimiento", "#af52de", g.stuck, today, "#6e6e73")}
    <tr><td align="center" style="padding:26px 4px 8px">
      <a href="${APP_URL}" style="display:inline-block;background:#007aff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:999px">Abrir Backbrain</a>
    </td></tr>
    <tr><td align="center" style="padding:10px 4px;font-size:12px;color:#8e8e93">Recibes este resumen porque eres responsable de estos pendientes. Puedes apagarlo en Backbrain, botón Equipo.</td></tr>
  </table></td></tr></table></body></html>`;
  const lines = (t: string, xs: Item[]) => xs.length ? `\n${t}\n${xs.map((x) => `- ${x.title}${x.deadline ? ` (${fmtShort(x.deadline)})` : ""}`).join("\n")}\n` : "";
  const text = `${hola}\n\n${intro}\n${lines("VENCIDOS", g.late)}${lines("PARA HOY", g.now)}${lines("PRÓXIMOS 3 DÍAS", g.next)}${lines("ESPERANDO RESPUESTA", g.wait)}${lines("NECESITA SEGUIMIENTO (ATORADOS EN SU ETAPA)", g.stuck)}\nAbrir Backbrain: ${APP_URL}`;
  return { subject, html, text };
}

function buildWeekly(name: string, today: string, rowsData: { name: string; open: number; late: Item[]; week: number; done: number; stuck: number }[]) {
  const hola = name ? `Hola ${esc(name.split(/\s+/)[0])},` : "Hola,";
  const tot = rowsData.reduce((a, r) => ({ open: a.open + r.open, late: a.late + r.late.length, done: a.done + r.done, stuck: a.stuck + r.stuck }), { open: 0, late: 0, done: 0, stuck: 0 });
  const subject = `Tu equipo esta semana: ${tot.late} vencido${tot.late === 1 ? "" : "s"}, ${tot.done} terminado${tot.done === 1 ? "" : "s"}`;
  const cell = (v: string | number, color = "#1c1c1e", bold = false) => `<td align="center" style="padding:10px 6px;font-size:14px;color:${color};${bold ? "font-weight:700;" : ""}border-top:1px solid #e5e5ea">${v}</td>`;
  const table = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:14px;overflow:hidden">
    <tr>${["Persona", "Abiertos", "Vencidos", "Vencen esta semana", "Terminados (7 d)"].map((t, i) => `<td ${i ? 'align="center"' : ""} style="padding:10px ${i ? 6 : 14}px;font-size:11px;font-weight:700;color:#8e8e93;text-transform:uppercase">${t}</td>`).join("")}</tr>
    ${rowsData.map((r) => `<tr><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#1c1c1e;border-top:1px solid #e5e5ea">${esc(r.name)}</td>${cell(r.open)}${cell(r.late.length, r.late.length ? "#ff3b30" : "#8e8e93", !!r.late.length)}${cell(r.week, r.week ? "#ff9500" : "#8e8e93")}${cell(r.done, r.done ? "#34c759" : "#8e8e93", !!r.done)}</tr>`).join("")}
  </table>`;
  const lateList = rowsData.filter((r) => r.late.length).map((r) => `<tr><td style="padding:16px 4px 6px;font-size:15px;font-weight:700;color:#1c1c1e">${esc(r.name)}</td></tr>
    <tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:14px;overflow:hidden">${r.late.slice(0, 6).map((it) => itemRow(it, today, "#ff3b30")).join("").replace('border-top:1px solid #e5e5ea', 'border-top:0')}</table></td></tr>`).join("");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f7"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px">
    <tr><td style="padding:0 4px 14px">
      <div style="font-size:13px;color:#6e6e73">Semana del ${fmtLong(today)}</div>
      <div style="font-size:26px;font-weight:700;color:#1c1c1e;letter-spacing:-0.6px;margin-top:2px">${hola}</div>
      <div style="font-size:15px;color:#3a3a3c;margin-top:6px">Así va tu equipo: ${tot.open} pendientes abiertos, ${tot.late} vencidos${tot.stuck ? ` y ${tot.stuck} atorados en su etapa` : ""}. La semana pasada se terminaron ${tot.done}.</div>
    </td></tr>
    <tr><td>${table}</td></tr>
    ${lateList ? `<tr><td style="padding:24px 4px 0;font-size:19px;font-weight:700;color:#ff3b30;letter-spacing:-0.3px">Vencidos por persona</td></tr>${lateList}` : ""}
    <tr><td align="center" style="padding:26px 4px 8px">
      <a href="${APP_URL}" style="display:inline-block;background:#007aff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:999px">Abrir Backbrain</a>
    </td></tr>
    <tr><td align="center" style="padding:10px 4px;font-size:12px;color:#8e8e93">Te llega cada lunes. Puedes apagarlo en Backbrain, botón Equipo.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${hola}\n\nAsí va tu equipo: ${tot.open} abiertos, ${tot.late} vencidos. Terminados la semana pasada: ${tot.done}.\n\n${rowsData.map((r) => `${r.name}: ${r.open} abiertos, ${r.late.length} vencidos, ${r.week} vencen esta semana, ${r.done} terminados`).join("\n")}\n\n${APP_URL}`;
  return { subject, html, text };
}

async function sendMail(to: string, mail: { subject: string; html: string; text: string }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  return r.ok ? "enviado" : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
}

Deno.serve(async (req) => {
  const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "digest_cron_secret").maybeSingle();
  if (!setting?.value || req.headers.get("x-cron-secret") !== setting.value) return new Response("No autorizado", { status: 401 });
  if (!RESEND_API_KEY) return new Response("Falta el secret RESEND_API_KEY", { status: 500 });

  let only: string | null = null, mode = "daily";
  try { const b = await req.json(); only = b?.user_id ?? null; mode = b?.mode === "weekly" ? "weekly" : "daily"; } catch { /* sin cuerpo: todos */ }

  const today = todayInTz();
  const [team, people, items] = await Promise.all([
    supabase.from("team_members").select("user_id"),
    supabase.from("profiles").select("id,email,full_name,daily_digest,stages_enabled,weekly_summary"),
    supabase.from("work_items").select("id,title,requester_name,client,deadline,priority,status,owner_id,stage,stage_changed_at").neq("status", "hecho"),
  ]);
  if (team.error || people.error || items.error) {
    console.error(team.error ?? people.error ?? items.error);
    return new Response("Error al leer datos", { status: 500 });
  }

  const results: Record<string, string> = {};
  const nameOf = (id: string) => { const p = people.data.find((x) => x.id === id); return p?.full_name || (p?.email ?? "Alguien").split("@")[0]; };

  if (mode === "weekly") {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: done, error } = await supabase.from("work_items").select("owner_id").eq("status", "hecho").gte("completed_at", since);
    if (error) { console.error(error); return new Response("Error al leer datos", { status: 500 }); }
    const all = items.data as Item[];
    const rowsData = team.data.map(({ user_id }) => {
      const mine = all.filter((it) => it.owner_id === user_id);
      return {
        name: nameOf(user_id),
        open: mine.length,
        late: mine.filter((it) => it.deadline && diffDays(it.deadline, today) < 0).sort(byPri),
        week: mine.filter((it) => it.deadline && diffDays(it.deadline, today) >= 0 && diffDays(it.deadline, today) <= 6).length,
        done: (done ?? []).filter((d) => d.owner_id === user_id).length,
        stuck: mine.filter((it) => isStuck(it, today)).length,
      };
    }).sort((a, b) => b.late.length - a.late.length || b.open - a.open || a.name.localeCompare(b.name, "es"));
    for (const { user_id } of team.data) {
      if (only && user_id !== only) continue;
      const p = people.data.find((x) => x.id === user_id);
      if (!p?.email || (!only && !p.weekly_summary)) continue;
      results[p.email] = await sendMail(p.email, buildWeekly(p.full_name, today, rowsData));
    }
    console.log(JSON.stringify({ today, mode, results }));
    return new Response(JSON.stringify({ today, mode, results }), { headers: { "Content-Type": "application/json" } });
  }

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
      stuck: [] as Item[],
    };
    if (p.stages_enabled) {
      const shown = new Set([...g.late, ...g.now, ...g.next, ...g.wait].map((it) => it.id));
      g.stuck = mine.filter((it) => isStuck(it, today) && !shown.has(it.id)).sort((a, b) => daysInStage(b, today) - daysInStage(a, today));
    }
    if (!g.late.length && !g.now.length && !g.next.length && !g.wait.length && !g.stuck.length) { results[p.email] = "nada pendiente"; continue; }
    results[p.email] = await sendMail(p.email, buildEmail(p.full_name, today, g));
  }
  console.log(JSON.stringify({ today, results }));
  return new Response(JSON.stringify({ today, results }), { headers: { "Content-Type": "application/json" } });
});
