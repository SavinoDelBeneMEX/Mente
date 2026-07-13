# Mente — guía de despliegue (Supabase + Vercel)

Esta carpeta tiene todo lo necesario para que Mente pase de ser una página que vive
en tu navegador a una app real con **cuenta propia**, **datos sincronizados** y
**recordatorios push** que llegan aunque tengas el navegador cerrado.

Piezas:
- `index.html` + `sw.js` → el sitio (frontend). Se despliega en **Vercel**.
- `supabase/schema.sql` → las tablas de la base de datos. Se corre una vez en **Supabase**.
- `supabase/functions/send-reminders/` → la función que manda los push. Se despliega en **Supabase**.

Ya generé las claves VAPID que necesita el push:

```
Public Key:  BHLpzcBBE9GBdyWL5ansmZV_Ej7xY4SOnq7Kdt6HznvDYJnmlgw9tF9jT04d-6EhjQkjLv97h5fJ1DYf8HHYlpo
Private Key: hvN0iW_fhGbR4fX1VTBNF3i0flmc4eMpiUXYtSgTOx0
```

La clave pública ya está puesta en `index.html`. Guardá la privada, la vas a necesitar en el paso 3.

---

## 1. Crear el proyecto en Supabase

1. Andá a [supabase.com](https://supabase.com) y creá una cuenta / iniciá sesión.
2. **New project** → elegí un nombre (ej. "mente"), una contraseña de base de datos (guardala) y una región cercana.
3. Esperá 1-2 minutos a que se aprovisione.

## 2. Cargar el esquema de base de datos

1. En el panel de tu proyecto, andá a **SQL Editor**.
2. Abrí el archivo `supabase/schema.sql` de esta carpeta, copiá todo el contenido y pegalo en el editor.
3. Ejecutalo (**Run**). Esto crea las tablas `tasks`, `reminders`, `push_subscriptions` con seguridad a nivel de fila (cada usuario solo ve lo suyo).

## 3. Configurar y desplegar la función que envía los push

Necesitás el [Supabase CLI](https://supabase.com/docs/guides/cli) instalado (`npm install -g supabase` o el instalador de su web).

1. Iniciá sesión y vinculá el proyecto:
   ```
   supabase login
   supabase link --project-ref TU-PROJECT-REF
   ```
   (el `project-ref` está en la URL de tu proyecto: `https://TU-PROJECT-REF.supabase.co`)

2. Configurá los secretos que usa la función (reemplazá los valores):
   ```
   supabase secrets set VAPID_PUBLIC_KEY=BHLpzcBBE9GBdyWL5ansmZV_Ej7xY4SOnq7Kdt6HznvDYJnmlgw9tF9jT04d-6EhjQkjLv97h5fJ1DYf8HHYlpo
   supabase secrets set VAPID_PRIVATE_KEY=hvN0iW_fhGbR4fX1VTBNF3i0flmc4eMpiUXYtSgTOx0
   ```
   (`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están disponibles automáticamente dentro de las Edge Functions, no hace falta configurarlos)

3. Desplegá la función:
   ```
   supabase functions deploy send-reminders
   ```

## 4. Programar la función para que corra cada minuto

1. En el panel de Supabase, andá a **Database → Cron Jobs** (usa la extensión `pg_cron`).
2. Creá un job nuevo:
   - **Schedule**: `* * * * *` (cada minuto)
   - **Type**: HTTP Request
   - **Method**: POST
   - **URL**: `https://TU-PROJECT-REF.supabase.co/functions/v1/send-reminders`
   - **Headers**: `Authorization: Bearer TU-SERVICE-ROLE-KEY` (la encontrás en **Project Settings → API**)
3. Guardá. A partir de acá, cada minuto Supabase revisa qué recordatorios vencen y manda el push.

## 5. Conectar el frontend a tu proyecto

Abrí `index.html` y reemplazá, cerca del principio del archivo:

```js
window.MENTE_CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-ANON-PUBLIC-KEY',
  VAPID_PUBLIC_KEY: 'BHLpzcBBE9GBdyWL5ansmZV_Ej7xY4SOnq7Kdt6HznvDYJnmlgw9tF9jT04d-6EhjQkjLv97h5fJ1DYf8HHYlpo'
};
```

`SUPABASE_URL` y `SUPABASE_ANON_KEY` (la clave pública "anon") están en **Project Settings → API** de tu proyecto Supabase.

### Opcional pero recomendado: desactivar la confirmación por email

Como es una app personal, en **Authentication → Providers → Email** podés desactivar
"Confirm email" para no tener que confirmar tu casilla la primera vez que te registrás
en la propia app. Si lo dejás activado, Supabase te va a mandar un mail de confirmación
al crear la cuenta — confirmalo y después iniciá sesión normalmente.

## 6. Desplegar el frontend en Vercel

**Opción simple (sin terminal):**
1. Andá a [vercel.com](https://vercel.com), creá una cuenta.
2. **Add New → Project → Deploy without Git** (o arrastrá la carpeta si te lo ofrece).
3. Subí esta carpeta completa (`index.html` y `sw.js`, no hace falta subir `supabase/`).
4. Vercel te da una URL tipo `https://mente-tuusuario.vercel.app` — esa es tu app.

**Opción con CLI:**
```
npm install -g vercel
cd mente-app
vercel --prod
```

## 7. Probarlo

1. Abrí la URL de Vercel en tu celular o PC.
2. Creá tu cuenta (email + contraseña) y entrá.
3. Tocá **🔔 Recordatorios** arriba — el navegador te va a pedir permiso, aceptalo.
4. Creá una tarea con un recordatorio a 2 minutos de ahora.
5. **Cerrá la pestaña y el navegador por completo.** En unos minutos debería llegarte
   la notificación del sistema operativo igual, porque ahora el que "vigila" el reloj
   es Supabase, no tu navegador.

## Actualización: tareas recurrentes que se auto-generan

A partir de este cambio, las tareas recurrentes (diario / días hábiles / cada X días)
aparecen solas según el calendario, aunque no hayas completado la ocurrencia anterior —
igual que un evento de calendario real. Antes, la siguiente ocurrencia solo se creaba
al marcar la actual como hecha.

Si ya tenías el proyecto funcionando desde antes, hacen falta dos pasos únicos:

1. **Correr la migración de base de datos** — en el **SQL Editor** de Supabase, pegá y
   ejecutá el contenido de `supabase/migration_series_id.sql` (agrega una columna nueva,
   no borra nada de lo que ya tenés).
2. **Redesplegar la función**:
   ```
   npx supabase@latest functions deploy send-reminders
   ```
3. Subí el `index.html` actualizado a tu repo/Vercel como siempre (o esperá el deploy
   automático si ya lo conectaste a GitHub).

Con esto, la misma función que revisa los recordatorios cada minuto también revisa si
falta crear la próxima ocurrencia de cada tarea recurrente y la genera sola.

## Notas y límites

- Cada dispositivo/navegador donde tocás "🔔 Recordatorios" queda suscripto por separado — si
  usás el celu y la PC, activalo en ambos para recibir el push en los dos.
- En iPhone, las notificaciones push web funcionan mejor si primero "agregás la página a
  Inicio" (compartir → Agregar a pantalla de inicio) antes de activar los recordatorios.
- Si algún día cambiás de dominio (otra URL de Vercel), las suscripciones push viejas quedan
  inválidas — hay que volver a tocar "🔔 Recordatorios" desde la nueva URL.
- Las rachas, el sonido y el filtro Personal/Trabajo siguen guardándose en el navegador
  (no en la base de datos), así que esas preferencias son por dispositivo.
