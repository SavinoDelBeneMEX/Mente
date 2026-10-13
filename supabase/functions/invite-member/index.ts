// Edge Function: invita a alguien al equipo de Backbrain y le manda el correo (Resend).
// Solo la puede llamar un miembro del equipo con su sesión (JWT).
// - Si el correo ya tiene cuenta: lo agrega al equipo y le avisa.
// - Si no: guarda la invitación; al registrarse con ese correo entra solo (trigger handle_new_user_profile).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("DIGEST_FROM") ?? "Backbrain <no-reply@creditossdb.com.mx>";
const APP_URL = "https://mente-teal.vercel.app/backbrain";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function inviteEmail(inviter: string, email: string, hasAccount: boolean) {
  const link = hasAccount ? APP_URL : `${APP_URL}?correo=${encodeURIComponent(email)}`;
  const subject = hasAccount ? `${inviter} te agregó a su equipo en Backbrain` : `${inviter} te invitó a Backbrain`;
  const lead = hasAccount
    ? `${esc(inviter)} te agregó a su equipo. Ya puedes ver y actualizar los pendientes que te asignen.`
    : `${esc(inviter)} te invitó a su equipo en Backbrain, donde anotamos los pendientes, quién los pidió, para cuándo y su seguimiento.`;
  const steps = hasAccount
    ? `Entra con tu cuenta de siempre.`
    : `Da clic en el botón, crea tu cuenta con <b>${esc(email)}</b> y entrarás directo al equipo.`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f7"><tr><td align="center" style="padding:32px 14px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:500px;background:#ffffff;border-radius:22px">
    <tr><td style="padding:32px 28px 8px">
      <div style="width:52px;height:52px;border-radius:14px;background:#5856d6;color:#ffffff;font-size:28px;line-height:52px;text-align:center;font-weight:800;letter-spacing:-1px">B</div>
      <div style="font-size:26px;font-weight:700;color:#1c1c1e;letter-spacing:-0.6px;margin-top:18px">${hasAccount ? "Ya estás en el equipo" : "Te invitaron a Backbrain"}</div>
      <div style="font-size:15px;color:#3a3a3c;line-height:1.5;margin-top:10px">${lead}</div>
      <div style="font-size:15px;color:#3a3a3c;line-height:1.5;margin-top:10px">${steps}</div>
    </td></tr>
    <tr><td style="padding:22px 28px 30px">
      <a href="${link}" style="display:inline-block;background:#007aff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:999px">${hasAccount ? "Abrir Backbrain" : "Crear mi cuenta"}</a>
      <div style="font-size:12px;color:#8e8e93;margin-top:16px">Si el botón no funciona, copia esta dirección: ${esc(link)}</div>
    </td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${hasAccount ? "Ya estás en el equipo" : "Te invitaron a Backbrain"}\n\n${lead.replace(/<[^>]+>/g, "")}\n${steps.replace(/<[^>]+>/g, "")}\n\n${link}`;
  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!RESEND_API_KEY) return json({ error: "Falta el secret RESEND_API_KEY" }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  const caller = who?.user;
  if (!caller) return json({ error: "Inicia sesión de nuevo." }, 401);
  const { data: member } = await admin.from("team_members").select("user_id").eq("user_id", caller.id).maybeSingle();
  if (!member) return json({ error: "Solo los miembros del equipo pueden invitar." }, 403);

  let email = "";
  try { email = String((await req.json())?.email ?? "").trim().toLowerCase(); } catch { /* sin cuerpo */ }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Escribe un correo válido." }, 400);

  const { data: me } = await admin.from("profiles").select("full_name,email").eq("id", caller.id).maybeSingle();
  const inviter = me?.full_name || (me?.email ?? caller.email ?? "Alguien").split("@")[0];

  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  let status: "added" | "already" | "invited";
  if (existing) {
    const { data: already } = await admin.from("team_members").select("user_id").eq("user_id", existing.id).maybeSingle();
    if (already) {
      status = "already"; // ya es del equipo: se le reenvía el correo con el acceso
    } else {
      const ins = await admin.from("team_members").insert({ user_id: existing.id, added_by: caller.id });
      if (ins.error) return json({ error: "No se pudo agregar al equipo." }, 500);
      status = "added";
    }
  } else {
    const up = await admin.from("team_invites").upsert({ email, invited_by: caller.id, invited_at: new Date().toISOString(), accepted_at: null });
    if (up.error) return json({ error: "No se pudo guardar la invitación." }, 500);
    status = "invited";
  }

  const mail = inviteEmail(inviter, email, status !== "invited");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], reply_to: me?.email ?? caller.email, subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!r.ok) {
    console.error("resend", r.status, await r.text());
    return json({ status, emailed: false });
  }
  return json({ status, emailed: true });
});
