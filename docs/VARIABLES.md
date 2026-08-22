# Variables de entorno

Qué necesita la app para arrancar, qué es opcional y qué se rompe si falta.

En local viven en `.env.local`, que está en `.gitignore`. En Vercel se definen en
**Settings → Environment Variables**. `.env.example` es la plantilla y sí se
commitea: nunca lleva valores reales.

Para comprobar que están todas y bien formadas:

```bash
pnpm env:check
```

Valida prefijos, formato de URL y longitud de secretos. Nació de un pegado
truncado del secreto de Stripe que costó horas encontrar: el prefijo coincidía y
le faltaba un carácter.

---

## Resumen

| Variable | ¿Obligatoria? | Secreta | Si falta |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | No | La app no arranca |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sí | No | La app no arranca |
| `NEXT_PUBLIC_SITE_URL` | Sí | No | Enlaces rotos en correos |
| `SUPABASE_SECRET_KEY` | Sí | **Sí** | Fallan subidas y webhooks |
| `CRON_SECRET` | Sí en producción | **Sí** | El cron diario responde 401 |
| `RESEND_API_KEY` | No | **Sí** | No se envía ningún correo |
| `RESEND_FROM_EMAIL` | No | No | No se envía ningún correo |
| `SITE_PASSWORD` | No | **Sí** | Sitio público, sin puerta |
| `STRIPE_SECRET_KEY` | No | **Sí** | Sin pago con tarjeta |
| `STRIPE_WEBHOOK_SECRET` | No | **Sí** | Los webhooks se rechazan |
| `SUPABASE_DB_URL` | Solo local | **Sí** | Los scripts no corren |
| `BUSINESS_TIMEZONE` | No | No | Nada — ver nota al final |

Las que empiezan por `NEXT_PUBLIC_` **se incrustan en el código que llega al
navegador**. Cualquiera puede leerlas. Nunca pongas un secreto con ese prefijo.

---

## Supabase

### `NEXT_PUBLIC_SUPABASE_URL`

```
https://dvzuudnngvcvdajtmxyp.supabase.co
```

Dashboard → menú Copy → Project URL. Pública por diseño.

### `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

```
sb_publishable_...
```

Pública por diseño: va al navegador y todo lo que puede hacer con ella está
limitado por las políticas RLS de la base. Es la clave con la que operan los
visitantes.

### `SUPABASE_SECRET_KEY`

```
sb_secret_...
```

Settings → API Keys → pestaña Secret keys → Reveal.

**Salta RLS por completo.** Solo se usa donde el servidor ya autorizó la
operación por su cuenta: subir un comprobante al bucket privado, registrar un
cobro desde el webhook de Stripe, o el trabajo diario del cron.

Nunca la prefijes con `NEXT_PUBLIC_` ni la importes desde un componente cliente.
`serverEnv()` lanza si se ejecuta en el navegador, precisamente para que un
import descuidado falle en desarrollo y no en producción.

### `SUPABASE_DB_URL`

```
postgresql://postgres.<ref>:<contraseña>@aws-0-<región>.pooler.supabase.com:5432/postgres
```

**Solo en local. No la pongas en Vercel.**

Es una conexión directa a Postgres y la usan únicamente los scripts:
`db:check`, aplicar migraciones, `seed`, `stripe:reconcile`. La app desplegada
nunca habla con Postgres directamente — va por el cliente de Supabase sobre
HTTPS.

Dos motivos para no subirla:

- Es la credencial más peligrosa que existe en el proyecto: acceso directo,
  saltándose RLS y saltándose la API. Un secreto que no se usa no debería estar
  ahí.
- Tampoco funcionaría bien: cada invocación serverless abriría su propia
  conexión y agotaría el límite del plan gratuito con poco tráfico.

Usa la cadena del **Session pooler**, no la conexión directa: `db.<ref>.supabase.co`
solo resuelve por IPv6 y falla en muchas redes.

---

## Sitio

### `NEXT_PUBLIC_SITE_URL`

```
https://reserve.lngeneralservices.com
```

De aquí salen los enlaces de los correos, las URLs de retorno de Stripe y el
`metadataBase` de las etiquetas sociales.

Si apunta a un dominio equivocado, los huéspedes reciben enlaces que no abren.
Es el fallo que tuvimos cuando apuntaba al dominio de producción desde local: se
pagaba en Stripe y el retorno llevaba a una página inexistente.

La barra final da igual — se recorta al leerla.

En desarrollo la URL de retorno de Stripe se saca del host real de la petición,
no de esta variable. En producción manda esta: la cabecera `Host` la controla
quien hace la petición, y confiar en ella permitiría desviar a alguien a otro
sitio justo después de pagar.

### `SITE_PASSWORD`

```
SITE_PASSWORD=una-contraseña-compartida
```

**Opcional. Definida activa la puerta; ausente o vacía, el sitio es público.**

Ver la sección dedicada más abajo.

---

## Correo

### `RESEND_API_KEY` y `RESEND_FROM_EMAIL`

```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=reservas@reserve.lngeneralservices.com
```

Son opcionales en el sentido de que la app arranca sin ellas, pero **el correo
es el único camino de vuelta del huésped a su reserva**: el código solo vive en
la URL. Sin correo, quien cierre la pestaña pierde el acceso y no puede pagar.

Si falla un envío, no se aborta la operación que lo disparó —una reserva creada
sigue siendo válida— y el fallo queda registrado en la tabla `email_log`, que se
consulta desde `/admin/ajustes`. Existe porque el plan Hobby retiene una hora de
logs y un fallo silencioso ahí deja a alguien sin poder pagar y sin saber por
qué.

El dominio del remitente debe estar verificado en Resend.

---

## Cron

### `CRON_SECRET`

```
CRON_SECRET=<32 o más caracteres aleatorios>
```

Generar uno:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Vercel lo envía como `Authorization: Bearer <valor>` a `/api/cron/daily`. Sin
él, el endpoint responde 401 **siempre**, incluido el cron de Vercel.

Ese trabajo diario hace tres cosas, y la segunda es la que sorprende:

1. Descarga la tasa BCV del día.
2. **Mantiene vivo el proyecto de Supabase.** El plan gratuito pausa los
   proyectos tras siete días sin peticiones. Una posada puede pasar una semana
   sin reservas en temporada baja; sin este latido, la web queda caída justo
   cuando llegue el primer visitante.
3. Envía recordatorios a quien llega mañana y poda las bitácoras.

Conviene que el de producción sea **distinto** del local: si un día se filtra el
de desarrollo, no abre también producción.

**Está copiado en Supabase Vault.** El sondeo de tasa cada media hora sale de
pg_cron dentro de la base, y `pg_net` necesita mandar el mismo Bearer. Al rotar
el `CRON_SECRET` hay que correr:

```bash
node --env-file=.env.local scripts/setup-rate-cron.mjs
```

Si se olvida, el sondeo recibe 401 y **no lo dice**: pg_net es asíncrono y nadie
lee la respuesta. La tasa se queda congelada y quien avisa es `rate_is_stale()`,
tres días más tarde. `pnpm db:check` comprueba que los secretos siguen ahí, pero
no que sigan valiendo.

---

## Stripe

**Ninguna de las dos está en producción todavía**, y es deliberado. La app
funciona sin ellas: la sección «Pagar con tarjeta» no aparece y el webhook
responde 503. El reporte manual de comprobante es el camino principal y no
depende de Stripe.

### `STRIPE_SECRET_KEY`

```
sk_test_...
```

Dashboard → Developers → API keys → Secret key.

En modo sandbox (`sk_test_`) funciona la integración completa sin verificación de
negocio: sirve para desarrollar y probar. `pnpm env:check` avisa en rojo si
detecta una clave `sk_live_`.

Activar cobros **reales** exige una entidad legal en un país soportado por
Stripe, y Venezuela no lo está.

### `STRIPE_WEBHOOK_SECRET`

```
whsec_ + 64 caracteres hexadecimales
```

**Cada endpoint tiene el suyo.** Hay tres secretos distintos posibles y
confundirlos es el error que ya cometimos una vez:

| Origen | Para qué |
|---|---|
| `stripe listen --print-secret` | El listener local de la CLI |
| Destino registrado en el Dashboard | Producción |
| Otro proyecto cualquiera | **No sirve** — rechaza todos los eventos con 400 |

Cuenta los caracteres antes de darlo por bueno. Un pegado al que le falta uno
mantiene el prefijo correcto y todos los webhooks fallan con 400 sin pista de
por qué. `pnpm env:check` lo detecta.

### Nunca una sola de las dos

Poner **solo** `STRIPE_SECRET_KEY` es peor que no poner ninguna: el botón de
tarjeta aparece, el huésped paga de verdad, y como no hay webhook la reserva
nunca se confirma. Dinero cobrado, huésped esperando, fechas que expiran solas.

Van juntas o no van.

Si un webhook llega a fallar, `pnpm stripe:reconcile` compara lo que Stripe dice
haber cobrado contra lo que hay en la base y cierra la diferencia.

---

## La puerta de acceso: `SITE_PASSWORD`

### Por qué existe

Vercel ofrece protección de despliegues, pero en el plan Hobby su modo
**Standard Protection** cubre los previews y las URLs `*.vercel.app` y deja
fuera **el dominio propio en producción**. Proteger ese requiere el plan Pro.

Esta puerta lo cubre sin coste y sobre cualquier dominio.

### Cómo funciona

Vive en `src/middleware.ts` y usa HTTP Basic Auth. Con la variable definida:

- Toda ruta pide credenciales antes de mostrar nada. El diálogo lo dibuja el
  navegador; no hay pantalla de la app.
- **El usuario da igual** — solo se comprueba la contraseña.
- Se añade la cabecera `X-Robots-Tag: noindex, nofollow`.

Quedan **exentos** `/api/webhooks/*` y `/api/cron/*`. No es un descuido: Stripe
no puede enviar Basic Auth y el cron trae su propio secreto. Sin esa exención,
activar la puerta habría roto los cobros y la tasa BCV en silencio.

Sin la variable, el middleware sigue existiendo pero no hace nada, y la
protección normal de `/admin` —sesión de Supabase con comprobación de rol—
funciona igual.

### Qué es y qué no

Es una barrera contra visitantes casuales y rastreadores. **No es seguridad de
verdad**: la contraseña se comparte entre todos los que acceden y viaja en cada
petición.

Y no confundir con ocultar la URL: los certificados TLS se publican en los logs
de Certificate Transparency, así que cualquier subdominio es enumerable en
segundos. **Lo que protege es la puerta, no que nadie conozca la dirección.**

Consecuencia práctica: la puerta se quita cuando el sitio esté listo para ser
público, no antes.

### Cómo quitarla

1. Borrar `SITE_PASSWORD` en Vercel.
2. **Volver a desplegar.** Los cambios de variables no alcanzan a los despliegues
   ya construidos.
3. Devolver el `matcher` de `src/middleware.ts` a `['/admin/:path*']`. Este paso
   es manual: se amplió a todo el sitio para que la puerta lo cubriera, y con
   ella fuera es una invocación por visita pública que no hace falta. Ver
   `PENDIENTES.md`.

---

## Configuración en Vercel

Para el despliegue de pruebas actual:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL
SUPABASE_SECRET_KEY
CRON_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
SITE_PASSWORD
```

**No subir**: `SUPABASE_DB_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

Márcalas para Production, Preview y Development salvo que quieras separar
entornos; con una sola base de datos, lo simple es marcarlas las tres.

Recuerda que **cambiar una variable no afecta a un despliegue ya construido**.
Hay que volver a desplegar.

---

## Nota: `BUSINESS_TIMEZONE` no se usa

Está declarada en `.env.example` y en el esquema de `serverEnv()`, pero **ningún
código la lee**. La zona horaria aparece literal como `America/Caracas` en siete
sitios entre el código y las migraciones.

No es un fallo con consecuencias —el valor coincide— pero es una variable que
promete algo que no cumple: cambiarla no cambia nada. O se conecta de verdad, o
se quita. Anotado en `PENDIENTES.md`.
