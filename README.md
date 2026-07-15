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

## Actualización: fotos por tarea (con opción obligatoria) y Bloc de Notas

Cada tarea puede tener fotos adjuntas (por ejemplo, evidencia de que se hizo), y al crearla
podés marcarla como "requiere foto para completarla" — si la marcás, el check queda bloqueado
hasta que subas al menos una imagen. También hay una pestaña nueva, **Notas**, para anotar
cosas sueltas que no son pendientes.

Si ya tenías el proyecto funcionando desde antes, hacen falta dos pasos únicos:

1. **Correr la migración de base de datos** — en el **SQL Editor** de Supabase, pegá y
   ejecutá el contenido de `supabase/migration_photos_notes.sql`. Esto agrega las columnas
   de fotos a `tasks`, crea la tabla `notes` y crea el bucket de Storage `task-photos`
   (público, ver el comentario en el propio archivo sobre por qué).
2. Subí el `index.html` actualizado a tu repo/Vercel como siempre (o esperá el deploy
   automático si ya lo conectaste a GitHub).

No hace falta redesplegar ninguna función ni tocar `supabase/functions/`, esta parte es
100% frontend + Storage.

## Actualización: recordatorios duplicados en tareas repetitivas (bug corregido)

Se detectó un bug donde una tarea repetitiva (diario / días hábiles / cada X días) podía
mandar la misma notificación decenas de veces de golpe (una por cada ocurrencia futura que
la función de recordatorios pre-genera, hasta 60 días adelante) en vez de una sola vez. Ya
está corregido en `index.html` (ahora solo se crea 1 recordatorio por serie, no uno por
ocurrencia), pero si ya te pasó, tienes recordatorios duplicados guardados en la base.

1. **Correr la limpieza** — en el **SQL Editor** de Supabase, pega y ejecuta el contenido de
   `supabase/migration_dedupe_reminders.sql`. Borra los duplicados y deja solo 1 recordatorio
   por serie repetitiva (no toca tareas ni recordatorios de una sola vez).
2. Sube el `index.html` actualizado como siempre.

## Actualización: rediseño Apple, ícono propio, confirmación de un tercero y árbol/bosque

Tres cosas nuevas en esta actualización:

1. **Ícono de la app.** El favicon, el `apple-touch-icon.png` y los íconos del `manifest.json`
   (192px/512px) ahora usan tu imagen del cerebro en vez del emoji genérico. No requiere nada
   en Supabase, solo subir los archivos nuevos (`icon-192.png`, `icon-512.png`,
   `apple-touch-icon.png`, `manifest.json`) junto con el resto.

2. **Confirmación de una tarea por otra persona, sin que esa persona necesite cuenta.** Al
   crear una tarea podés activar el chip opcional "🤝 Requiere confirmación de alguien más" y
   escribir quién la va a confirmar. Esa tarea no se puede tachar hasta que la otra persona
   entra a un link público (`confirm.html?token=...`, generado automáticamente) y toca
   "Confirmar que se hizo" — ahí sí queda marcada como hecha. El link se manda con el botón
   "📤 Enviar para confirmar" dentro del detalle de la tarea (usa el mismo selector nativo de
   compartir que ya usa la app, para mandarlo por WhatsApp o lo que prefieras).

   Esto necesita un Edge Function nueva, **`confirm-task`**, que es la única parte de Supabase
   que queda abierta al público (sin login) — por diseño solo puede leer/confirmar la tarea
   puntual cuyo token coincide, nunca la tabla completa.

3. **Árbol del día y bosque.** Nueva pestaña **🌲 Bosque**: tu árbol va creciendo durante el día
   según el % de tus pendientes de **hoy** que vas completando (con fecha = hoy, sin importar
   el filtro Personal/Trabajo). Si completas todos antes de que acabe el día, el árbol florece
   y se "planta" en tu bosque esa noche; si dejas alguno sin completar, se seca. Podés elegir
   la especie del árbol de hoy (roble, pino, palmera, abeto, cerezo, cactus) desde la misma
   pestaña. La evaluación de "¿cumplí ayer?" corre sola la primera vez que abres la app cada
   día — no hace falta ningún cron nuevo.

Pasos para actualizar un proyecto que ya tenías funcionando:

1. **Correr la migración de base de datos** — en el **SQL Editor** de Supabase, pega y ejecuta
   el contenido de `supabase/migration_confirmation_forest.sql`. Agrega las columnas de
   confirmación a `tasks` y crea la tabla `tree_days`.
2. **Desplegar el Edge Function nuevo**:
   ```
   supabase functions deploy confirm-task --no-verify-jwt
   ```
   (`--no-verify-jwt` es clave: sin eso, Supabase exige un usuario logueado para llamar la
   función, y la persona que confirma la tarea justamente no tiene cuenta. La función igual
   solo expone la fila puntual del token, nunca datos de otras tareas ni de otros usuarios.)
3. Sube `index.html`, `confirm.html`, `vercel.json` y los íconos actualizados a tu repo/Vercel
   como siempre.

`vercel.json` desactiva las "clean URLs" a propósito: sin eso, algunos hostings reescriben
`/confirm.html?token=...` a `/confirm` y en el camino pierden el `?token=...`, lo que rompería
todos los links de confirmación ya enviados.

## Notas y límites

- Cada dispositivo/navegador donde tocás "🔔 Recordatorios" queda suscripto por separado — si
  usás el celu y la PC, activalo en ambos para recibir el push en los dos.
- En iPhone, las notificaciones push web funcionan mejor si primero "agregás la página a
  Inicio" (compartir → Agregar a pantalla de inicio) antes de activar los recordatorios.
- Si algún día cambiás de dominio (otra URL de Vercel), las suscripciones push viejas quedan
  inválidas — hay que volver a tocar "🔔 Recordatorios" desde la nueva URL.
- Las rachas, el sonido y el filtro Personal/Trabajo siguen guardándose en el navegador
  (no en la base de datos), así que esas preferencias son por dispositivo.
