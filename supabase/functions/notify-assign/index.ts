// Edge Function: avisa por correo (Resend) cuando a alguien le asignan un pendiente en Backbrain.
// La llama el trigger work_items_notify_assignment (ver supabase/migration_mejoras_backbrain.sql)
// con el header x-cron-secret, cuyo valor vive en public.app_settings (key = digest_cron_secret).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("DIGEST_FROM") ?? "Backbrain <no-reply@creditossdb.com.mx>";
const APP_URL = "https://mente-teal.vercel.app/backbrain";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const PRI: Record<string, { l: string; c: string }> = {
  urgente: { l: "Urgente", c: "#ff3b30" }, alta: { l: "Alta", c: "#ff9500" },
  media: { l: "Media", c: "#007aff" }, baja: { l: "Baja", c: "#8e8e93" },
};
const MESL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const fmtLong = (s: string) => { const [y, m, d] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return `${DIA[dt.getUTCDay()]} ${d} de ${MESL[m - 1]}`; };
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const displayName = (p?: { full_name?: string; email?: string } | null) => p?.full_name || (p?.email ?? "Alguien").split("@")[0];

Deno.serve(async (req) => {
  const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "digest_cron_secret").maybeSingle();
  if (!setting?.value || req.headers.get("x-cron-secret") !== setting.value) return new Response("No autorizado", { status: 401 });
  if (!RESEND_API_KEY) return new Response("Falta el secret RESEND_API_KEY", { status: 500 });

  let itemId = "", by: string | null = null;
  try { const b = await req.json(); itemId = b?.item_id ?? ""; by = b?.by ?? null; } catch { /* sin cuerpo */ }
  if (!itemId) return new Response("Falta item_id", { status: 400 });

  const { data: it } = await supabase.from("work_items")
    .select("id,title,description,requester_name,client,deadline,priority,status,owner_id").eq("id", itemId).maybeSingle();
  if (!it?.owner_id || it.status === "hecho") return Response.json({ skipped: true });
  if (!by || by === it.owner_id) return Response.json({ skipped: "autoasignado" }); // autoasignarse no manda correo

  const ids = [it.owner_id, by].filter(Boolean) as string[];
  const { data: people } = await supabase.from("profiles").select("id,email,full_name").in("id", ids);
  const owner = people?.find((p) => p.id === it.owner_id);
  const who = people?.find((p) => p.id === by);
  if (!owner?.email) return Response.json({ skipped: "sin correo" });

  const assigner = displayName(who);
  const p = PRI[it.priority] ?? PRI.media;
  const link = `${APP_URL}?p=${it.id}`;
  const rows = [
    it.client ? ["Cliente / proveedor", esc(it.client)] : null,
    it.requester_name ? ["Lo solicitó", esc(it.requester_name)] : null,
    ["Fecha compromiso", it.deadline ? esc(fmtLong(it.deadline)) : "Sin fecha"],
    ["Prioridad", `<span style="color:${p.c};font-weight:600">${p.l}</span>`],
  ].filter(Boolean) as string[][];
  const desc = (it.description ?? "").trim();
  const subject = `${assigner} te asignó: ${it.title}`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f7"><tr><td align="center" style="padding:32px 14px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:22px">
    <tr><td style="padding:28px 28px 6px">
      <div style="font-size:13px;color:#6e6e73">${esc(assigner)} te asignó un pendiente</div>
      <div style="font-size:24px;font-weight:700;color:#1c1c1e;letter-spacing:-0.5px;margin-top:6px;line-height:1.25">${esc(it.title)}</div>
      ${desc ? `<div style="font-size:15px;color:#3a3a3c;line-height:1.5;margin-top:10px;white-space:pre-wrap">${esc(desc.slice(0, 600))}</div>` : ""}
    </td></tr>
    <tr><td style="padding:14px 28px 4px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f7;border-radius:14px">
        ${rows.map(([k, v], i) => `<tr><td style="padding:10px 14px;font-size:13px;color:#6e6e73;${i ? "border-top:1px solid #e5e5ea;" : ""}">${k}</td><td align="right" style="padding:10px 14px;font-size:14px;color:#1c1c1e;${i ? "border-top:1px solid #e5e5ea;" : ""}">${v}</td></tr>`).join("")}
      </table>
    </td></tr>
    <tr><td style="padding:20px 28px 28px">
      <a href="${link}" style="display:inline-block;background:#007aff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 26px;border-radius:999px">Abrir el pendiente</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${assigner} te asignó un pendiente: ${it.title}\n\n${rows.map(([k, v]) => `${k}: ${v.replace(/<[^>]+>/g, "")}`).join("\n")}${desc ? `\n\n${desc}` : ""}\n\n${link}`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [owner.email], reply_to: who?.email, subject, html, text }),
  });
  const out = r.ok ? "enviado" : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
  console.log(JSON.stringify({ item: it.id, to: owner.email, out }));
  return Response.json({ result: out });
});
