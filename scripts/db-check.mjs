// Verifica contra la base real que el esquema quedó como se espera:
// tablas, restricción anti-solape, funciones y RLS.
//
//   pnpm db:check

import { readFileSync } from 'node:fs'
import pg from 'pg'

// Carga .env.local sin depender del orden de dotenv.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

const EXPECTED_TABLES = [
  'amenities', 'app_settings', 'availability_blocks', 'bookings',
  'exchange_rates', 'payment_accounts', 'payments', 'profiles',
  'rate_fetch_log', 'season_rates', 'site_content', 'unit_amenities',
  'unit_holds', 'unit_media', 'units',
]

const EXPECTED_FUNCTIONS = [
  'business_today', 'create_booking', 'current_gap', 'current_rate',
  'current_rate_date', 'expire_stale_bookings', 'get_booking', 'handle_new_user',
  'is_available', 'is_staff', 'prune_rate_fetch_log', 'quote_stay',
  'rate_is_stale', 'refresh_booking_rate', 'report_payment',
]

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

await client.connect()

const { rows: tables } = await client.query(
  `select table_name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'`,
)
const found = tables.map((r) => r.table_name)
for (const t of EXPECTED_TABLES) check(`tabla ${t}`, found.includes(t))

const { rows: fns } = await client.query(
  `select proname from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'`,
)
const fnNames = fns.map((r) => r.proname)
for (const f of EXPECTED_FUNCTIONS) check(`función ${f}()`, fnNames.includes(f))

const { rows: excl } = await client.query(
  `select conname from pg_constraint
   where conname = 'unit_holds_no_overlap' and contype = 'x'`,
)
check('EXCLUDE anti-solape en unit_holds', excl.length === 1)

const { rows: rls } = await client.query(
  `select relname from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
)
check('RLS activo en todas las tablas', rls.length === 0,
  rls.length ? `sin RLS: ${rls.map((r) => r.relname).join(', ')}` : '')

// Prueba real de la restricción: dos reservas solapadas deben fallar.
await client.query('begin')
try {
  const { rows: [unit] } = await client.query(
    `insert into units (name, slug, base_price_usd)
     values ('__test', '__test', 50) returning id`,
  )
  await client.query(
    `insert into unit_holds (unit_id, stay, kind)
     values ($1, daterange('2030-01-10','2030-01-15','[)'), 'booking')`, [unit.id],
  )

  // El INSERT que debe fallar aborta la transacción, así que va dentro de un
  // savepoint: sin esto todo lo que venga después muere con 25P02.
  let rejected = false
  await client.query('savepoint overlap_probe')
  try {
    await client.query(
      `insert into unit_holds (unit_id, stay, kind)
       values ($1, daterange('2030-01-14','2030-01-18','[)'), 'booking')`, [unit.id],
    )
    await client.query('release savepoint overlap_probe')
  } catch (e) {
    rejected = e.code === '23P01' // exclusion_violation
    await client.query('rollback to savepoint overlap_probe')
  }
  check('rechaza solape de fechas', rejected)

  // Salida el 15 y entrada el 15 no colisionan: rango semiabierto.
  let adjacentOk = true
  let adjacentErr = ''
  await client.query('savepoint adjacent_probe')
  try {
    await client.query(
      `insert into unit_holds (unit_id, stay, kind)
       values ($1, daterange('2030-01-15','2030-01-20','[)'), 'booking')`, [unit.id],
    )
    await client.query('release savepoint adjacent_probe')
  } catch (e) {
    adjacentOk = false
    adjacentErr = e.code
    await client.query('rollback to savepoint adjacent_probe')
  }
  check('permite check-out y check-in el mismo día', adjacentOk, adjacentErr)

  const { rows: [q] } = await client.query(
    `select quote_stay($1, '2030-06-01', '2030-06-04', 2) as q`, [unit.id],
  )
  check('quote_stay() responde', q.q !== null, JSON.stringify(q.q))

  // El BCV cierra entre las 6 y las 8 de la tarde y lo que publica al cerrar el
  // viernes lleva fecha valor del lunes. Desde ese instante es la tasa legal: no
  // espera al lunes. Así que una tasa con fecha valor futura sí debe usarse.
  //
  // Se sonda con una fecha lejana y se borra después, para no pisar la fila real
  // de mañana — que existe en cuanto el BCV publica por la tarde.
  const { rows: [rateBefore] } = await client.query('select current_rate() as r')
  await client.query(
    `insert into exchange_rates (rate_date, market, usd_ves, source)
     values (business_today() + 90, 'oficial', 999.999999, 'prueba')
     on conflict (rate_date, market) do update set usd_ves = excluded.usd_ves`,
  )
  const { rows: [rateAfter] } = await client.query('select current_rate() as r')
  await client.query(
    `delete from exchange_rates
     where market = 'oficial' and rate_date = business_today() + 90`,
  )
  check(
    'usa la última publicada aunque su fecha valor sea futura',
    Number(rateAfter.r) === 999.999999,
    `antes ${rateBefore.r}, después ${rateAfter.r}`,
  )


  // Cobrar al paralelo es infracción a la Ley de Precios Justos: current_rate()
  // solo puede mirar el mercado oficial.
  await client.query(
    `insert into exchange_rates (rate_date, market, usd_ves, source)
     values (business_today(), 'paralelo', 5000, 'prueba')
     on conflict (rate_date, market) do update set usd_ves = excluded.usd_ves`,
  )
  const { rows: [ignoresParallel] } = await client.query('select current_rate() as r')
  check(
    'current_rate() ignora el paralelo',
    String(ignoresParallel.r) === String(rateBefore.r),
    `oficial ${ignoresParallel.r} con paralelo en 5000`,
  )

  /*
    Si el alimentador lleva días caído, no se cotiza en bolívares en vez de
    cobrar con una tasa vieja.

    Las tasas se apartan y se repone una vieja, en lugar de correrles la fecha
    diez días. Correrlas funcionaba con pocas filas y empezó a chocar en cuanto
    el histórico pasó de diez días: `08-20 menos 10` cae sobre el `08-10` que
    todavía no se había movido, y el índice único lo rechaza. Apartarlas no
    depende de cuántas haya.
  */
  await client.query(
    `create temp table _rates_backup on commit drop as
     select * from exchange_rates where market = 'oficial'`,
  )
  await client.query(`delete from exchange_rates where market = 'oficial'`)
  await client.query(
    `insert into exchange_rates (rate_date, market, usd_ves, source)
     values (business_today() - 30, 'oficial', 100, 'prueba')`,
  )
  const { rows: [stale] } = await client.query('select rate_is_stale() as s')
  const { rows: [staleQuote] } = await client.query(
    `select quote_stay($1, '2030-06-01', '2030-06-04', 2) as q`, [unit.id],
  )
  check(
    'rechaza cotizar con tasa rancia',
    stale.s === true && staleQuote.q?.error === 'stale_rate',
    JSON.stringify(staleQuote.q),
  )

  /*
    Las dos mitades tienen que estar de acuerdo en qué día es.

    Postgres guarda su propia copia de la zona horaria dentro de
    `business_today()` —una migración no puede leer una variable de entorno— y
    la app la suya en `src/lib/timezone.ts`. Si se separan, el desacuerdo no
    aparece como error: aparece como una tasa que entra en vigor antes de tiempo
    o unas llegadas que se adelantan un día. Por eso se compara el resultado, no
    la cadena de configuración.
  */
  const { rows: [tz] } = await client.query('select business_today()::text as hoy')
  const appToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.BUSINESS_TIMEZONE || 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  check(
    'Postgres y la app coinciden en el día del negocio',
    tz.hoy === appToday,
    `base ${tz.hoy} · app ${appToday}`,
  )

  // El flujo completo: crear reserva, rechazar la solapada, reportar pago.
  await client.query(`delete from exchange_rates where market = 'oficial'`)
  await client.query(`insert into exchange_rates select * from _rates_backup`)
  const { rows: [created] } = await client.query(
    `select create_booking($1,'2031-02-10','2031-02-14',2,'Prueba','prueba@example.com',null,null,null) as r`,
    [unit.id],
  )
  check('create_booking() crea la reserva', created.r?.ok === true, created.r?.error ?? '')

  const { rows: [clash] } = await client.query(
    `select create_booking($1,'2031-02-12','2031-02-16',2,'Otro','otro@example.com',null,null,null) as r`,
    [unit.id],
  )
  check('create_booking() rechaza solape', clash.r?.error === 'unavailable', JSON.stringify(clash.r))

  if (created.r?.ok) {
    const { rows: [paid] } = await client.query(
      `select report_payment($1,'zelle','USD',10,'a@b.c','REF-1',now(),null,null,null) as r`,
      [created.r.code],
    )
    check('report_payment() registra el pago', paid.r?.ok === true, JSON.stringify(paid.r))

    const { rows: [future] } = await client.query(
      `select report_payment($1,'zelle','USD',10,'a@b.c','REF-2',now()+interval '5 days',null,null,null) as r`,
      [created.r.code],
    )
    check('report_payment() rechaza fecha futura', future.r?.error === 'future_date')
  }

  // pg_cron debe estar liberando los pendientes vencidos.
  const { rows: cron } = await client.query(
    `select active from cron.job where jobname = 'expire-stale-bookings'`,
  )
  check('pg_cron expira reservas pendientes', cron[0]?.active === true)

  // El sondeo de tasa. Desde que rige la última publicada (migración 0033), leer
  // una vez al día deja horas cobrando con una tasa que ya no es legal, así que
  // esta tarea es parte del cumplimiento y no una comodidad.
  const { rows: [ping] } = await client.query(
    `select schedule, active from cron.job where jobname = 'fetch-bcv-rate'`,
  )
  check(
    'pg_cron sondea la tasa BCV',
    ping?.active === true,
    ping ? `${ping.schedule} · activa=${ping.active}` : 'tarea ausente',
  )

  // Sin los secretos en Vault la tarea corre y falla en silencio: pg_net es
  // asíncrono y nadie mira el resultado. Se comprueba que descifran, no su valor.
  const { rows: [vault] } = await client.query(
    `select count(*)::int as n from vault.decrypted_secrets
     where name in ('cron_secret', 'site_url') and decrypted_secret is not null`,
  )
  check(
    'Vault tiene los secretos del sondeo',
    vault.n === 2,
    vault.n === 2 ? undefined : `${vault.n}/2 — correr scripts/setup-rate-cron.mjs`,
  )

  const { rows: bucket } = await client.query(
    `select public from storage.buckets where id = 'receipts'`,
  )
  check('bucket receipts existe y es privado', bucket[0]?.public === false)
} finally {
  await client.query('rollback') // no deja rastro en la base
}

await client.end()

console.log(failures ? `\n${failures} comprobacion(es) fallida(s)` : '\nTodo correcto')
process.exit(failures ? 1 : 0)
