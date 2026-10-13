-- Resumen diario por correo de la Bitácora de Pendientes (función daily-digest).
-- Cada persona puede apagarlo desde la Bitácora (botón Equipo).
-- La función además necesita el secret RESEND_API_KEY (Edge Functions → Secrets).
alter table public.profiles add column if not exists daily_digest boolean not null default true;

-- Ajustes internos: solo los lee la función con la service role (RLS activo y sin políticas).
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;

-- Secreto compartido entre el Cron Job y la función. Genera uno al azar al aplicar.
insert into public.app_settings (key, value)
values ('digest_cron_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Todos los días a las 7:30 a. m. hora de Ciudad de México (13:30 UTC; México ya no cambia de horario).
select cron.unschedule('BITACORA_RESUMEN') where exists (select 1 from cron.job where jobname = 'BITACORA_RESUMEN');
select cron.schedule('BITACORA_RESUMEN', '30 13 * * *', $$
  select net.http_post(
    url := 'https://ecmenbgaeqvojfcgyjgc.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'x-cron-secret', (select value from public.app_settings where key = 'digest_cron_secret'),
      'Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  );
$$);
