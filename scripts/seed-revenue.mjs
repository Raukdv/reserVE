/**
 * Datos de prueba para la sección de ingresos: julio y agosto de 2026.
 *
 *   node --env-file=.env.local scripts/seed-revenue.mjs
 *   node --env-file=.env.local scripts/seed-revenue.mjs --limpiar
 *
 * ## Qué monta
 *
 * Treinta estadías repartidas entre las cinco unidades, con cobros por los seis
 * canales, un anticipo sin saldar, dos cancelaciones con devolución —una entera
 * y otra a medias— y una reserva que expiró sin pagar. Deja julio sobre los
 * 5.600 y agosto sobre los 11.700, con la ocupación en torno al 45 %: cifras con
 * forma real, en vez de ceros.
 *
 * ## El mes es el del cobro, no el de la estadía
 *
 * `revenue_by_month()` agrupa por `paid_at`, que es lo correcto —el dinero entró
 * cuando entró—, y en la vida real un anticipo se paga con semanas de antelación
 * y cae en el mes anterior. Aquí los cobros se limitan al mes de la entrada a
 * propósito: con la antelación de verdad, casi todo agosto se contaba en julio y
 * julio en junio, y el objetivo era ver poblados esos dos meses.
 *
 * **Sin IVA.** No se toca `app_settings.vat_enabled` ni se crea ningún cargo
 * marcado como impuesto: la sección tiene que verse bien en el estado en que de
 * verdad opera hoy.
 *
 * ## Por qué inserta a mano y no llama a `create_booking()`
 *
 * Esa función rechaza fechas pasadas —comprueba `advance_notice_days` y
 * devuelve `too_soon`—, que es correcto para una reserva de verdad e inservible
 * para sembrar histórico. Así que se escriben las filas directamente, incluida
 * la retención en `unit_holds`, que es lo que impide el solape.
 *
 * ## Cómo se reconoce y se borra
 *
 * Todas las reservas llevan correo `@seed.local`. `--limpiar` borra esas y sus
 * retenciones; los pagos se van solos por la cascada. Nada más se toca.
 */
import { Client } from 'pg'

const MARCA = '@seed.local'

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

/** Tasa BCV plausible de cada mes. Se congela en la reserva, como en producción. */
const TASA = { '2026-07': 742.18, '2026-08': 779.95 }

/**
 * Las estadías. `pagos` son importes en USD ya aprobados; `devuelto` sale como
 * movimiento de reembolso.
 *
 * Las fechas no se solapan dentro de una misma unidad: el `EXCLUDE` de
 * `unit_holds` lo rechazaría, que es exactamente su trabajo.
 */
const ESTADIAS = [
  // Julio
  { unidad: 'prueba-suite-mar',        in: '2026-07-03', out: '2026-07-06', huesped: 'Ana Rivas',        pagos: [['zelle', 360]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-07-04', out: '2026-07-08', huesped: 'Familia Perdomo',  pagos: [['transferencia', 640], ['efectivo', 640]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-07-05', out: '2026-07-07', huesped: 'Luis Betancourt',  pagos: [['pago_movil', 150]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-07-10', out: '2026-07-14', huesped: 'Carmen Ochoa',     pagos: [['binance', 720]] },
  { unidad: 'jardin',                  in: '2026-07-12', out: '2026-07-15', huesped: 'Jorge Salcedo',    pagos: [['zelle', 300]] },
  { unidad: 'prueba-suite-mar',        in: '2026-07-18', out: '2026-07-22', huesped: 'Marta Guillén',    pagos: [['usdt', 480]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-07-20', out: '2026-07-24', huesped: 'Grupo Anzoátegui', pagos: [['transferencia', 1280]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-07-22', out: '2026-07-26', huesped: 'Pedro Rondón',     pagos: [['efectivo', 300]] },
  // Cancelada tras cobrar: devolución completa.
  { unidad: 'prueba-bungalow-palmera', in: '2026-07-25', out: '2026-07-28', huesped: 'Elena Vargas',     pagos: [['zelle', 540]], devuelto: ['zelle', 540], estado: 'cancelled' },
  { unidad: 'jardin',                  in: '2026-07-27', out: '2026-07-31', huesped: 'Andrés Molina',    pagos: [['pago_movil', 800]] },

  // Agosto
  { unidad: 'prueba-habitacion-coral', in: '2026-08-01', out: '2026-08-05', huesped: 'Yolanda Mejías',   pagos: [['pago_movil', 300]] },
  { unidad: 'prueba-suite-mar',        in: '2026-08-02', out: '2026-08-05', huesped: 'Sofía Delgado',    pagos: [['zelle', 360]] },
  { unidad: 'jardin',                  in: '2026-08-02', out: '2026-08-06', huesped: 'Óscar Lares',      pagos: [['transferencia', 800]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-08-03', out: '2026-08-07', huesped: 'Verónica Silva',   pagos: [['binance', 720]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-08-05', out: '2026-08-09', huesped: 'Familia Urdaneta', pagos: [['transferencia', 1280]] },
  { unidad: 'prueba-suite-mar',        in: '2026-08-06', out: '2026-08-10', huesped: 'Hugo Peñalver',    pagos: [['efectivo', 480]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-08-08', out: '2026-08-11', huesped: 'Nelson Rivero',    pagos: [['efectivo', 225]] },
  // Solo el anticipo: el saldo quedó pendiente.
  { unidad: 'prueba-casa-brisa',       in: '2026-08-10', out: '2026-08-14', huesped: 'Gabriel Antón',    pagos: [['zelle', 384]] },
  { unidad: 'prueba-suite-mar',        in: '2026-08-11', out: '2026-08-15', huesped: 'Lucía Bermúdez',   pagos: [['usdt', 480]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-08-12', out: '2026-08-16', huesped: 'Isabel Castro',    pagos: [['binance', 720]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-08-12', out: '2026-08-16', huesped: 'Ramón Quintero',   pagos: [['pago_movil', 300]] },
  { unidad: 'jardin',                  in: '2026-08-14', out: '2026-08-18', huesped: 'Rafael Nieves',    pagos: [['zelle', 400], ['efectivo', 400]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-08-15', out: '2026-08-20', huesped: 'Congreso Mérida',  pagos: [['transferencia', 1600]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-08-17', out: '2026-08-21', huesped: 'Patricia Rojas',   pagos: [['zelle', 720]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-08-18', out: '2026-08-22', huesped: 'Simón Alcalá',     pagos: [['efectivo', 300]] },
  { unidad: 'jardin',                  in: '2026-08-19', out: '2026-08-23', huesped: 'Teresa Villegas',  pagos: [['binance', 800]] },
  // Cancelada con penalización: se devuelve la mitad.
  { unidad: 'prueba-suite-mar',        in: '2026-08-19', out: '2026-08-22', huesped: 'Daniela Paredes',  pagos: [['usdt', 360]], devuelto: ['usdt', 180], estado: 'cancelled' },
  { unidad: 'prueba-casa-brisa',       in: '2026-08-21', out: '2026-08-24', huesped: 'Tomás Herrera',    pagos: [['transferencia', 960]] },
  { unidad: 'prueba-suite-mar',        in: '2026-08-23', out: '2026-08-26', huesped: 'Marisol Guédez',   pagos: [['zelle', 360]] },
  // Nunca pagó y expiró. Aparece en el calendario y en nada más.
  { unidad: 'prueba-habitacion-coral', in: '2026-08-28', out: '2026-08-31', huesped: 'Reserva sin pagar', pagos: [], estado: 'expired' },
]

const mesDe = (iso) => iso.slice(0, 7)

/**
 * Cuándo se cobró: el anticipo unos días antes de entrar, el saldo al llegar.
 *
 * Sin tocar el mes de la estadía. Un anticipo de verdad se paga con semanas de
 * antelación y cae en el mes anterior —así funciona y así lo cuenta el informe,
 * que agrupa por fecha de cobro y no por fecha de estadía—, pero aquí eso movía
 * casi todo el dinero de agosto a julio y de julio a junio, y el objetivo es
 * tener julio y agosto poblados. Se limita al día 1 del mes de entrada.
 */
const cobradoEl = (entrada, i) => {
  const d = new Date(`${entrada}T12:00:00Z`)
  if (i === 0) d.setUTCDate(Math.max(d.getUTCDate() - 5, 1))
  return d.toISOString()
}

await client.connect()

try {
  if (process.argv.includes('--limpiar')) {
    const { rows: holds } = await client.query(
      `select hold_id from bookings where guest_email like $1`, [`%${MARCA}`],
    )
    const { rowCount: borradas } = await client.query(
      `delete from bookings where guest_email like $1`, [`%${MARCA}`],
    )
    // Después de las reservas: hold_id es ON DELETE RESTRICT.
    if (holds.length) {
      await client.query(
        `delete from unit_holds where id = any($1::uuid[])`,
        [holds.map((h) => h.hold_id)],
      )
    }
    console.log(`borradas ${borradas} reservas de prueba y ${holds.length} retenciones`)
    process.exit(0)
  }

  const { rows: [{ hoy }] } = await client.query('select business_today()::text as hoy')
  const { rows: unidades } = await client.query('select id, slug, base_price_usd from units')
  const porSlug = new Map(unidades.map((u) => [u.slug, u]))

  const faltan = ESTADIAS.filter((e) => !porSlug.has(e.unidad)).map((e) => e.unidad)
  if (faltan.length) {
    console.error(`no existen estas unidades: ${[...new Set(faltan)].join(', ')}`)
    process.exit(1)
  }

  const { rows: [ya] } = await client.query(
    `select count(*)::int as n from bookings where guest_email like $1`, [`%${MARCA}`],
  )
  if (ya.n > 0) {
    console.error(`ya hay ${ya.n} reservas de prueba. Corre --limpiar antes de volver a sembrar.`)
    process.exit(1)
  }

  await client.query('begin')

  let creadas = 0
  for (const [n, e] of ESTADIAS.entries()) {
    const unidad = porSlug.get(e.unidad)
    const noches = (new Date(e.out) - new Date(e.in)) / 86_400_000
    const subtotal = Number(unidad.base_price_usd) * noches
    const tasa = TASA[mesDe(e.in)]

    // Una estadía que ya terminó está completada; la que aún no, confirmada.
    // Se decide contra el día real y no contra una fecha escrita a mano, para
    // que el seed no envejezca mal.
    const estado = e.estado ?? (e.out <= hoy ? 'completed' : 'confirmed')

    /*
      La retención es lo que ocupa el calendario, y la que impide el solape.

      Sigue activa mientras la reserva viva —completada o confirmada—; una
      cancelada o expirada la libera, igual que en producción. Antes esto solo
      la activaba para las completadas, lo que habría dejado libres en el
      calendario unas fechas que sí están vendidas.
    */
    const { rows: [hold] } = await client.query(
      `insert into unit_holds (unit_id, stay, kind, is_active)
       values ($1, daterange($2::date, $3::date, '[)'), 'booking', $4)
       returning id`,
      [unidad.id, e.in, e.out, estado === 'completed' || estado === 'confirmed'],
    )

    const { rows: [booking] } = await client.query(
      `insert into bookings (
         unit_id, hold_id, status, check_in, check_out, guests,
         guest_name, guest_email, subtotal_usd, total_usd,
         rate_snapshot, rate_date, total_ves, deposit_ratio, created_at,
         cancelled_at, cancel_reason
       ) values (
         $1, $2, $3, $4::date, $5::date, 2,
         $6, $7, $8::numeric, $8::numeric,
         $9::numeric, $4::date, round($8::numeric * $9::numeric, 2), 0.3,
         ($4::date - 14)::timestamptz,
         $10::timestamptz, $11
       ) returning id, code`,
      [
        unidad.id, hold.id, estado, e.in, e.out,
        e.huesped, `huesped${n + 1}${MARCA}`, subtotal,
        tasa,
        estado === 'cancelled' ? `${e.in}T10:00:00Z` : null,
        estado === 'cancelled' ? 'Cancelada por el huésped' : null,
      ],
    )

    for (const [i, [metodo, importe]] of e.pagos.entries()) {
      await client.query(
        `insert into payments (
           booking_id, kind, method, status, currency, amount, amount_usd,
           reference, paid_at, reviewed_at
         ) values ($1, $2, $3, 'approved', 'USD', $4, $4, $5, $6, $6)`,
        [
          booking.id, i === 0 ? 'deposit' : 'balance', metodo, importe,
          `SEED-${booking.code}-${i + 1}`, cobradoEl(e.in, i),
        ],
      )
    }

    if (e.devuelto) {
      const [metodo, importe] = e.devuelto
      await client.query(
        `insert into payments (
           booking_id, kind, method, status, currency, amount, amount_usd,
           reference, paid_at, reviewed_at
         ) values ($1, 'refund', $2, 'refunded', 'USD', $3, $3, $4, $5, $5)`,
        [booking.id, metodo, importe, `SEED-DEV-${booking.code}`, `${e.in}T16:00:00Z`],
      )
    }

    creadas++
  }

  await client.query('commit')

  console.log(`sembradas ${creadas} reservas de prueba\n`)

  const { rows: meses } = await client.query(
    `select month::text, charged_usd, refunded_usd, net_usd from revenue_by_month(3)`,
  )
  console.table(meses)

  const { rows: canales } = await client.query(
    `select * from revenue_by_method('2026-08-01')`,
  )
  console.table(canales)

  console.log('ocupación agosto:', (await client.query(
    `select occupancy_for_month('2026-08-01') o`,
  )).rows[0].o)
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
