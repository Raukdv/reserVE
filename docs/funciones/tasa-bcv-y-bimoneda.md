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

## La fecha valor: el BCV publica hoy para mañana

Es la particularidad que más código condiciona.

El BCV publica de lunes a viernes por la tarde, y esa tasa **entra en vigor el
siguiente día hábil**. No es la tasa de hoy: es la de mañana, publicada hoy. Por
eso la tabla se indexa por `rate_date` —la fecha en que la tasa *vale*— y no por
el momento en que se descargó:

```sql
create table exchange_rates (
  rate_date  date,
  market     text,      -- 'oficial' | 'paralelo'
  usd_ves    numeric(18, 6),
  fetched_at timestamptz,
  primary key (rate_date, market)
)
```

`current_rate()` toma la última con `rate_date <= business_today()`. Una tasa con
fecha valor futura ya descargada **no se usa** hasta que llegue su día.

Consecuencia práctica: la tasa **no cambia durante el día**. Una reserva cotizada
por la mañana y pagada por la tarde tiene el mismo importe en bolívares.

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

## Dos cifras vivas a la vez

Desde media tarde suele haber dos: la que rige hoy y la que el BCV ya publicó
para el siguiente día hábil. El panel las enseña por separado.

> Hoy se cobra a 773,313. El BCV ya publicó 775,336 con fecha valor 2026-08-19,
> que entra en vigor ese día.

No es adorno. El operador cotiza por teléfono mirando la pantalla, y si solo ve
un número no sabe si es el que le van a cobrar en el banco hoy o el de mañana.

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

`pnpm rate:fetch` descarga la tasa y la registra. Corre por cron diario, que es
lo único que permite el plan Hobby de Vercel.

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
ok   ignora tasa con fecha valor futura — antes 771,07, después 771,07
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
| Lectura desde Next | `src/lib/rates.ts`, `src/lib/bcv.ts` |
| Formato bimoneda | `price()` en `src/lib/format.ts` |
| Día del negocio en Next | `src/lib/business-date.ts` |

Decisiones 3 y 3.1 de `ARCHITECTURE.md`.
