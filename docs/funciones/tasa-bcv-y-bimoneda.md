# Tasa BCV y bimoneda

Se publica en dólares y se cobra en bolívares. Cómo se convierte, con qué tasa,
y por qué la elección de tasa no es una decisión técnica sino legal.

---

## Solo la tasa oficial puede cobrar

La **Ley de Precios Justos** obliga a operar a la tasa del Banco Central. Cobrar
a otra —aunque sea la que todo el mundo usa en la calle— es una infracción.

`current_rate()` filtra por `market = 'oficial'` y no admite otra cosa. No es una
preferencia configurable: no hay interruptor para cambiarla, a propósito.

El paralelo se registra, pero **no cobra**:

```sql
create or replace function current_gap()
-- Fracción por la que el paralelo supera al oficial.
-- No interviene en ningún cobro.
```

Existe para decidir el **precio de lista en USD**, que es la única palanca legal
frente a la brecha. Si el paralelo se dispara y las tarifas se quedan cortas, lo
que se sube es el precio en dólares — nunca la tasa de conversión.

El panel lo dice en la propia pantalla cuando la brecha pasa del 5 %.

---

## La fecha valor no marca el inicio de la vigencia

Es la particularidad que más código condiciona, y la que estuvo mal entendida
más tiempo.

El BCV abre sobre las 7:00 y cierra entre las 18:00 y las 20:00 VET. Lo que
publica al cerrar el viernes lleva **fecha valor del lunes**. Pero esa cifra es
la legal desde que se publica, no desde el lunes: el sábado y el domingo se
cotizan con ella.

O dicho corto: **rige la última publicada**, sea de mañana, tarde o noche.

La tabla se indexa igual por `rate_date` —la fecha valor que el BCV declara—,
porque es lo que hay que llevar a la factura y lo que identifica la publicación:

```sql
create table exchange_rates (
  rate_date  date,
  market     text,      -- 'oficial' | 'paralelo'
  usd_ves    numeric(18, 6),
  fetched_at timestamptz,
  primary key (rate_date, market)
)
```

`current_rate()` toma la de mayor `rate_date`, sin filtrar por el día. Una tasa
con fecha valor futura **sí se usa**, desde que se descarga.

### Lo que estaba mal

Hasta la migración `0033` había un filtro `rate_date <= business_today()`. La
lectura era que la fecha valor marcaba el inicio de la vigencia. No es así, y
costaba dinero: el sábado y el domingo se cotizaba con el cierre del jueves, que
para entonces el BCV ya había reemplazado dos veces. El fin de semana del
2026-08-21 eso eran 779,9522 en vez de 784,6633 — un 0,6 % de menos en cada
reserva.

### La consecuencia incómoda

La tasa **puede cambiar durante el día**, en el momento en que el BCV publique.
Una reserva cotizada por la mañana y pagada después de un cierre lleva importes
distintos en bolívares. `refresh_booking_rate()` ya existía para eso.

Y traslada toda la responsabilidad al alimentador: si no leemos poco después de
que el BCV cierre, cobramos con una tasa que dejó de ser la legal. Leer seguido
pasa de comodidad a cumplimiento.

---

## El día del negocio, no el del servidor

Postgres corre en UTC y Venezuela va cuatro horas por detrás:

```sql
create or replace function business_today()
  select (now() at time zone 'America/Caracas')::date;
```

Sin esto, entre las 8 de la noche y la medianoche `current_date` ya es el día
siguiente, y la tasa de mañana empezaría a aplicarse cuatro horas antes de
tiempo. `businessToday()` en `src/lib/business-date.ts` es su contraparte para el
código que compone consultas desde Next.

---

## Guardia de tasa rancia

```sql
create or replace function rate_is_stale()
  select coalesce(business_today() - current_rate_date() > 3, true);
```

El BCV no publica sábados, domingos ni feriados, así que un hueco de hasta tres
días es normal — un fin de semana largo entra. Más que eso significa que el
alimentador lleva días sin correr.

Con la tasa rancia, `quote_stay()` devuelve `stale_rate` y **no cotiza**. Es
deliberado: cotizar con una tasa vieja es a la vez cobrar mal y no cumplir. Sin
tasa ninguna, `coalesce(..., true)` la da por rancia — el caso peor es el que se
asume.

El panel avisa arriba del todo cuando ocurre, con la fecha de la última tasa
válida, porque lo que hay que arreglar es el cron.

---

## La tasa se congela con la reserva

Cada reserva guarda `rate_snapshot` y `rate_date` en el momento de crearse. Todo
lo que venga después usa esa tasa y no la de hoy:

- El importe en bolívares del total.
- La conversión de cualquier pago que llegue en VES.
- La conversión de cualquier devolución.

Sin congelarla, una reserva cotizada en enero y pagada en marzo cambiaría de
precio sola entre las dos fechas. El huésped acordó un número; ese número vale.

**Lo que caduca no es la reserva, es la cifra en bolívares.** Si
`current_rate_date()` deja de coincidir con la de la reserva, el monto en Bs hay
que recalcularlo — la reserva sigue viva.

---

## Una sola cifra viva

Hubo un bloque en el panel que enseñaba dos: «hoy se cobra a X, el BCV ya publicó
Y con fecha valor Z, que entra en vigor ese día». Era la misma equivocación de
antes vestida de interfaz. Cifra viva hay una, la última publicada, y el panel la
muestra con su fecha valor al lado.

Que la fecha valor esté por delante del calendario es normal desde el viernes por
la tarde hasta el lunes. No significa que no rija.

**El botón «Actualizar tasa»** del resumen pide una consulta sin esperar al cron
diario. Dos cosas que hace y conviene saber:

- **Informa de la tasa que rige hoy**, no de la que acaba de guardar. Una
  consulta a las seis de la tarde puede traer fecha valor de mañana; decir «tasa
  actualizada a 775,33» mientras el panel muestra 773,31 pondría dos cifras
  distintas en la misma pantalla.
- **No escribe si el importe ya está guardado** para esa fecha valor. Pulsarlo
  tres veces deja tres líneas en el registro y cero escrituras.

**No salta las comprobaciones.** «Forzar» es forzar la consulta, no la
validación: los guardias de divergencia entre fuentes y de salto diario siguen
aplicando. Saltárselos desde un botón sería poner un interruptor a la única
defensa sobre el número con el que se factura.

---

## Cómo se alimenta

`pnpm rate:fetch` descarga la tasa y la registra. En producción la pide el
endpoint `/api/cron/daily`, y lo llaman dos relojes distintos.

**El cron de Vercel, una vez al día.** Hace el trabajo completo: tasa,
recordatorios de llegada y poda de bitácoras. Es también el latido que impide la
pausa por inactividad de Supabase.

**pg_cron dentro de Supabase, cada media hora entre las 07:00 y las 21:00 VET.**
Llama a `/api/cron/daily?only=rate`, que hace la tasa y vuelve.

El segundo existe porque rige la última publicada: entre que el BCV publica y
que nosotros leemos, estamos cobrando con una tasa que ya no es legal. Una sola
lectura al día deja ese hueco abierto hasta 24 horas. El plan Hobby de Vercel no
admite más de un cron diario, pero pg_cron ya corría en el proyecto y `pg_net`
puede llamar hacia fuera, así que la frecuencia sale de la base.

Son 30 sondeos al día contra el millón de invocaciones del plan, y como no se
escribe si el valor no cambió, 29 de ellos no tocan la base.

### Por qué no una Edge Function

Fue la primera idea y no aguanta. Supabase no tiene planificador propio: sus
«scheduled edge functions» son `cron.schedule` + `net.http_post`, esto mismo con
una capa encima. Y habría que reimplementar en Deno lo que ya está en `bcv.ts`
—divergencia entre fuentes, salto diario anómalo, el TLS relajado solo para
`bcv.org.ve`—. Dos implementaciones de la misma norma legal es una de más.

### El secreto

`pg_net` manda el `CRON_SECRET` en la cabecera, así que el secreto vive en la
base. Va en **Supabase Vault**, cifrado, no en el texto de `cron.job`: esa tabla
la lee cualquiera con acceso a la base.

Los valores no están en la migración. Los siembra
`node --env-file=.env.local scripts/setup-rate-cron.mjs`, y **hay que volver a
correrlo cada vez que se rote el `CRON_SECRET`** — si no, el sondeo empieza a
recibir 401 en silencio, porque pg_net es asíncrono y nadie mira la respuesta.
Quien lo delata entonces es `rate_is_stale()`, tres días después.

Cada intento queda en `rate_fetch_log`: sirve para distinguir «hoy no publicaron»
de «el alimentador está caído», que desde fuera se ven igual. La tabla se poda
con `prune_rate_fetch_log()` para no crecer sin techo contra los 500 MB del plan
gratuito de Supabase.

Forzar una lectura diaria tiene además un motivo práctico: mantener viva la
integración. Ver `COSTO-CERO.md`.

---

## Cómo se muestra

`currency_display` en Ajustes decide qué ve el huésped: `usd`, `ves` o `both`.
El helper `price()` en `src/lib/format.ts` lo resuelve en un solo sitio.

Se publica en dólares porque es la moneda en que el negocio piensa sus tarifas y
la que el huésped compara con otras opciones. Se cobra en bolívares porque es lo
que exige la ley cuando se usan los canales de pago nacionales.

El IGTF va aparte y **no es una tasa**: lo causa el medio de pago. Ver
`cobro-y-verificacion.md`.

---

## Comprobado

`pnpm db:check` prueba las tres reglas que más caro salen si fallan:

```
ok   usa la última publicada aunque su fecha valor sea futura
ok   current_rate() ignora el paralelo — oficial 771,07 con paralelo en 5000
ok   rechaza cotizar con tasa rancia — {"ok":false,"error":"stale_rate"}
```

La segunda es la importante: se inserta un paralelo absurdo y se comprueba que
`current_rate()` no se inmuta. Es la prueba de que no se puede cobrar fuera de la
ley ni por accidente.

---

## Lo que no cubre

**El BCV alterna respuestas entre llamadas.** Observado el 2026-08-18: cuatro
consultas seguidas devolvieron dos fechas valor distintas, alternando. Ambas
plausibles, pero cuál se guarda depende de a qué nodo caiga la petición. En
observación — ver `PENDIENTES.md`.

**No hay histórico de qué tasa vio el huésped al cotizar** antes de reservar.
Solo se guarda la de la reserva creada. Para una discusión sobre un precio
mostrado y no reservado no hay rastro.

**La brecha no se archiva.** `current_gap()` la calcula sobre la última lectura
de cada mercado; no queda serie temporal para ver cómo evolucionó.

**`BUSINESS_TIMEZONE` está conectada a medias.** `businessToday()` la lee, pero
`business_today()` en Postgres tiene el literal `America/Caracas` dentro, y las
migraciones no pueden leer variables de entorno. Ver `PENDIENTES.md`.

---

## Dónde está el código

| Qué | Dónde |
|---|---|
| Tabla de tasas | `exchange_rates`, migraciones `0001` y `0003` |
| Día del negocio | `business_today()`, migración `0002` |
| Tasa vigente y su fecha valor | `current_rate()`, `current_rate_date()`, migración `0003` |
| Guardia de tasa rancia | `rate_is_stale()`, migración `0003` |
| Brecha, solo métrica | `current_gap()`, migración `0003` |
| Registro de intentos y su poda | `rate_fetch_log`, `prune_rate_fetch_log()`, migración `0002` |
| Alimentador | `scripts/fetch-bcv-rate.mjs`, `pnpm rate:fetch` |
| Cron diario | `vercel.json` y `src/app/api/cron/daily/route.ts` |
| Sondeo cada media hora | `cron_ping_rate()`, migración `0034` |
| Secretos del sondeo | Supabase Vault, `scripts/setup-rate-cron.mjs` |
| Lectura desde Next | `src/lib/rates.ts`, `src/lib/bcv.ts` |
| Formato bimoneda | `price()` en `src/lib/format.ts` |
| Día del negocio en Next | `src/lib/business-date.ts` |

Decisiones 3 y 3.1 de `ARCHITECTURE.md`.
