/**
 * Datos de prueba para ver el panel entero con contenido.
 *
 *   pnpm seed:revenue
 *   node --env-file=.env.local scripts/seed-revenue.mjs --limpiar
 *
 * ## Qué monta
 *
 * Julio, agosto y septiembre de 2026 repartidos entre las cinco unidades, para
 * que **Reservas**, **Pagos** e **Ingresos** tengan las tres su caso completo:
 *
 * - **Reservas** — los siete estados: completadas, una hospedada ahora mismo,
 *   confirmadas por venir, pendientes de pago, canceladas, un no-show y una
 *   expirada.
 * - **Pagos** — la bandeja de verificación con comprobantes reportados por el
 *   huésped, uno rechazado con su motivo, y las devoluciones.
 * - **Ingresos** — dos meses cerrados con cifras y canales de sobra.
 *
 * Los cobros en bolívares se guardan en VES con su tasa congelada, como en
 * producción: son los que enseñan el importe bimoneda.
 *
 * **Sin comprobantes.** `receipt_path` va nulo: el bucket es privado y subir
 * imágenes de prueba no aporta nada. La ficha de verificación ya contempla que
 * no haya captura.
 *
 * **Sin IVA.** No se toca `app_settings.vat_enabled` ni se crea ningún cargo
 * marcado como impuesto: el panel tiene que verse bien en el estado en que de
 * verdad opera hoy.
 *
 * ## El mes es el del cobro, no el de la estadía
 *
 * `revenue_by_month()` agrupa por `paid_at`, que es lo correcto: el dinero entró
 * cuando entró. En la vida real un anticipo se paga con semanas de antelación y
 * cae en el mes anterior. Aquí los cobros se limitan al mes de la entrada a
 * propósito —con la antelación de verdad, casi todo agosto se contaba en julio y
 * julio en junio— y el objetivo era ver esos meses poblados.
 *
 * ## Por qué inserta a mano y no llama a `create_booking()`
 *
 * Esa función rechaza fechas pasadas —comprueba `advance_notice_days` y devuelve
 * `too_soon`—, correcto para una reserva de verdad e inservible para sembrar
 * histórico. Se escriben las filas directamente, incluida la retención en
 * `unit_holds`, que es lo que ocupa el calendario e impide el solape.
 *
 * El `EXCLUDE` de `unit_holds` lleva `where (is_active)`, así que una cancelada,
 * una expirada o un no-show pueden solaparse con una estadía viva. Es lo que
 * permite sembrar esos casos sin buscarles hueco en el calendario.
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
const TASA = { '2026-07': 742.18, '2026-08': 779.95, '2026-09': 791.4 }

/** Métodos que se cobran en bolívares. El resto van en divisas. */
const EN_BOLIVARES = new Set(['pago_movil', 'c2p', 'transferencia'])

const BANCOS = ['Banesco', 'Mercantil', 'Provincial', 'Venezuela', 'BNC']

/**
 * Las estadías.
 *
 * `pagos` acepta `[metodo, importeUSD]` o un objeto con `estado` y datos del
 * pagador. Sin `estado`, el cobro está aprobado.
 */
const ESTADIAS = [
  // ---------------------------------------------------------------- Julio
  { unidad: 'prueba-suite-mar',        in: '2026-07-03', out: '2026-07-06', huesped: 'Ana Rivas',        doc: 'V-14235678', tel: '+584121234567', pagos: [['zelle', 360]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-07-04', out: '2026-07-08', huesped: 'Familia Perdomo',  doc: 'V-9876543',  tel: '+584241234567', pagos: [['transferencia', 640], ['efectivo', 640]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-07-05', out: '2026-07-07', huesped: 'Luis Betancourt',  doc: 'V-18445221', tel: '+584161234567', pagos: [['pago_movil', 150]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-07-10', out: '2026-07-14', huesped: 'Carmen Ochoa',     doc: 'V-11223344', tel: '+584141234567', pagos: [['binance', 720]] },
  // Anticipo cobrado y saldo aún pendiente.
  { unidad: 'jardin',                  in: '2026-07-12', out: '2026-07-15', huesped: 'Jorge Salcedo',    doc: 'V-7654321',  tel: '+584121112233', pagos: [['zelle', 300]] },
  { unidad: 'prueba-suite-mar',        in: '2026-07-18', out: '2026-07-22', huesped: 'Marta Guillén',    doc: 'E-84551200', tel: '+584129998877', pagos: [['usdt', 480]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-07-20', out: '2026-07-24', huesped: 'Grupo Anzoátegui', doc: 'J-305430170', tel: '+584125556677', pagos: [['transferencia', 1280]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-07-22', out: '2026-07-26', huesped: 'Pedro Rondón',     doc: 'V-16778899', tel: '+584143334455', pagos: [['efectivo', 300]] },
  // Cancelada tras cobrar: devolución completa.
  { unidad: 'prueba-bungalow-palmera', in: '2026-07-25', out: '2026-07-28', huesped: 'Elena Vargas',     doc: 'V-20114455', tel: '+584161239876', pagos: [['zelle', 540]], devuelto: ['zelle', 540], estado: 'cancelled' },
  { unidad: 'jardin',                  in: '2026-07-27', out: '2026-07-31', huesped: 'Andrés Molina',    doc: 'V-13445566', tel: '+584247778899', pagos: [['pago_movil', 800]] },

  // --------------------------------------------------------------- Agosto
  { unidad: 'prueba-habitacion-coral', in: '2026-08-01', out: '2026-08-05', huesped: 'Yolanda Mejías',   doc: 'V-10556677', tel: '+584122223344', pagos: [['pago_movil', 300]] },
  { unidad: 'prueba-suite-mar',        in: '2026-08-02', out: '2026-08-05', huesped: 'Sofía Delgado',    doc: 'V-22334455', tel: '+584126667788', pagos: [['zelle', 360]] },
  { unidad: 'jardin',                  in: '2026-08-02', out: '2026-08-06', huesped: 'Óscar Lares',      doc: 'V-8899001',  tel: '+584241119900', pagos: [['transferencia', 800]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-08-03', out: '2026-08-07', huesped: 'Verónica Silva',   doc: 'V-19002233', tel: '+584165554433', pagos: [['binance', 720]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-08-05', out: '2026-08-09', huesped: 'Familia Urdaneta', doc: 'V-12009988', tel: '+584143332211', pagos: [['transferencia', 1280]] },
  // No se presentó. Se retiene todo, y la retención queda inactiva.
  { unidad: 'prueba-habitacion-coral', in: '2026-08-06', out: '2026-08-09', huesped: 'Wilmer Aponte',    doc: 'V-15667788', tel: '+584128881122', pagos: [['zelle', 225]], estado: 'no_show' },
  { unidad: 'prueba-suite-mar',        in: '2026-08-06', out: '2026-08-10', huesped: 'Hugo Peñalver',    doc: 'V-17334455', tel: '+584122229988', pagos: [['efectivo', 480]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-08-08', out: '2026-08-11', huesped: 'Nelson Rivero',    doc: 'V-14778800', tel: '+584161112233', pagos: [['efectivo', 225]] },
  // Anticipo cobrado, saldo pendiente.
  { unidad: 'prueba-casa-brisa',       in: '2026-08-10', out: '2026-08-14', huesped: 'Gabriel Antón',    doc: 'V-21556677', tel: '+584125558811', pagos: [['zelle', 384]] },
  { unidad: 'prueba-suite-mar',        in: '2026-08-11', out: '2026-08-15', huesped: 'Lucía Bermúdez',   doc: 'V-18990011', tel: '+584247774455', pagos: [['usdt', 480]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-08-12', out: '2026-08-16', huesped: 'Isabel Castro',    doc: 'V-16223344', tel: '+584143336677', pagos: [['binance', 720]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-08-12', out: '2026-08-16', huesped: 'Ramón Quintero',   doc: 'V-9112233',  tel: '+584129994455', pagos: [['pago_movil', 300]] },
  { unidad: 'jardin',                  in: '2026-08-14', out: '2026-08-18', huesped: 'Rafael Nieves',    doc: 'V-20445566', tel: '+584161117788', pagos: [['zelle', 400], ['efectivo', 400]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-08-15', out: '2026-08-20', huesped: 'Congreso Mérida',  doc: 'J-410992384', tel: '+584122228899', pagos: [['transferencia', 1600]] },
  { unidad: 'prueba-bungalow-palmera', in: '2026-08-17', out: '2026-08-21', huesped: 'Patricia Rojas',   doc: 'V-13889900', tel: '+584241113344', pagos: [['zelle', 720]] },
  { unidad: 'prueba-habitacion-coral', in: '2026-08-18', out: '2026-08-22', huesped: 'Simón Alcalá',     doc: 'V-17009911', tel: '+584125552211', pagos: [['efectivo', 300]] },
  { unidad: 'jardin',                  in: '2026-08-19', out: '2026-08-23', huesped: 'Teresa Villegas',  doc: 'V-11667788', tel: '+584143339900', pagos: [['binance', 800]] },
  // Cancelada con penalización: se devuelve la mitad.
  { unidad: 'prueba-suite-mar',        in: '2026-08-19', out: '2026-08-22', huesped: 'Daniela Paredes',  doc: 'V-19445566', tel: '+584161114455', pagos: [['usdt', 360]], devuelto: ['usdt', 180], estado: 'cancelled' },
  { unidad: 'prueba-casa-brisa',       in: '2026-08-21', out: '2026-08-24', huesped: 'Tomás Herrera',    doc: 'V-15112233', tel: '+584129997766', pagos: [['transferencia', 960]] },
  // Hospedada ahora mismo: el estado sale solo de las fechas.
  { unidad: 'prueba-suite-mar',        in: '2026-08-23', out: '2026-08-26', huesped: 'Marisol Guédez',   doc: 'V-22889900', tel: '+584241115566', pagos: [['zelle', 360]] },
  // Nunca pagó y expiró.
  { unidad: 'prueba-habitacion-coral', in: '2026-08-28', out: '2026-08-31', huesped: 'Reserva sin pagar', doc: 'V-24001122', tel: '+584122224466', pagos: [], estado: 'expired' },

  // ----------------------------------------------------- Septiembre, por venir
  // Confirmadas con anticipo cobrado.
  { unidad: 'jardin',                  in: '2026-09-04', out: '2026-09-08', huesped: 'Alberto Suárez',   doc: 'V-12556677', tel: '+584161119988', pagos: [['transferencia', 240]] },
  { unidad: 'prueba-casa-brisa',       in: '2026-09-05', out: '2026-09-10', huesped: 'Familia Chacín',   doc: 'V-14889900', tel: '+584143331122', pagos: [['zelle', 480]] },

  // Pendientes con el comprobante reportado y sin verificar: la bandeja de Pagos.
  {
    unidad: 'prueba-suite-mar', in: '2026-09-03', out: '2026-09-07',
    huesped: 'Rosa Delgado', doc: 'V-16334455', tel: '+584122227733', estado: 'pending',
    pagos: [{ metodo: 'pago_movil', usd: 144, estado: 'verifying' }],
  },
  {
    unidad: 'prueba-bungalow-palmera', in: '2026-09-06', out: '2026-09-09',
    huesped: 'Iván Márquez', doc: 'V-20778899', tel: '+584241114477', estado: 'pending',
    pagos: [{ metodo: 'zelle', usd: 162, estado: 'verifying' }],
  },
  {
    unidad: 'prueba-habitacion-coral', in: '2026-09-08', out: '2026-09-12',
    huesped: 'Beatriz Fonseca', doc: 'V-18112233', tel: '+584125553399', estado: 'pending',
    pagos: [{ metodo: 'binance', usd: 90, estado: 'verifying' }],
  },
  {
    unidad: 'jardin', in: '2026-09-11', out: '2026-09-14',
    huesped: 'Kevin Osorio', doc: 'V-25334455', tel: '+584161116622', estado: 'pending',
    // Reportó una referencia que no aparece en la cuenta.
    pagos: [
      { metodo: 'pago_movil', usd: 180, estado: 'rejected', motivo: 'La referencia no aparece en el estado de cuenta.' },
      { metodo: 'pago_movil', usd: 180, estado: 'verifying' },
    ],
  },
]

const mesDe = (iso) => iso.slice(0, 7)

/**
 * Cuándo se cobró: el anticipo unos días antes de entrar, el saldo al llegar.
 * Limitado al día 1 del mes de la entrada — ver la nota de arriba.
 */
const cobradoEl = (entrada, i) => {
  const d = new Date(`${entrada}T12:00:00Z`)
  if (i === 0) d.setUTCDate(Math.max(d.getUTCDate() - 5, 1))
  return d.toISOString()
}

/** Normaliza las dos formas de escribir un pago. */
const comoPago = (p) =>
  Array.isArray(p) ? { metodo: p[0], usd: p[1], estado: 'approved' } : { estado: 'approved', ...p }

/** Sin tildes ni eñes: es para componer un correo, no para mostrar un nombre. */
const sinTildes = (s) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

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

  for (const [n, e] of ESTADIAS.entries()) {
    const unidad = porSlug.get(e.unidad)
    const noches = (new Date(e.out) - new Date(e.in)) / 86_400_000
    const subtotal = Number(unidad.base_price_usd) * noches
    const tasa = TASA[mesDe(e.in)]

    // El estado sale de las fechas salvo que se fuerce: así el seed no envejece
    // mal y «hospedado ahora mismo» sigue siéndolo mañana.
    const estado =
      e.estado ??
      (e.out <= hoy ? 'completed' : e.in <= hoy ? 'checked_in' : 'confirmed')

    // La retención sigue activa mientras la reserva viva. Una cancelada,
    // expirada o no-show la libera; el EXCLUDE lleva `where (is_active)`, así
    // que esas pueden solaparse con una estadía viva sin chocar.
    const viva = ['completed', 'checked_in', 'confirmed', 'pending'].includes(estado)

    const { rows: [hold] } = await client.query(
      `insert into unit_holds (unit_id, stay, kind, is_active)
       values ($1, daterange($2::date, $3::date, '[)'), 'booking', $4)
       returning id`,
      [unidad.id, e.in, e.out, viva],
    )

    const { rows: [booking] } = await client.query(
      `insert into bookings (
         unit_id, hold_id, status, check_in, check_out, guests,
         guest_name, guest_email, guest_phone, guest_document,
         subtotal_usd, total_usd, rate_snapshot, rate_date, total_ves,
         deposit_ratio, created_at, expires_at, cancelled_at, cancel_reason,
         refund_due_usd
       ) values (
         $1, $2, $3, $4::date, $5::date, 2,
         $6, $7, $8, $9,
         $10::numeric, $10::numeric, $11::numeric, $4::date,
         round($10::numeric * $11::numeric, 2),
         0.3, ($4::date - 14)::timestamptz, $12::timestamptz,
         $13::timestamptz, $14, $15::numeric
       ) returning id, code`,
      [
        unidad.id, hold.id, estado, e.in, e.out,
        e.huesped, `huesped${n + 1}${MARCA}`, e.tel, e.doc,
        subtotal, tasa,
        estado === 'pending' ? `${hoy}T23:00:00Z` : null,
        estado === 'cancelled' || estado === 'no_show' ? `${e.in}T10:00:00Z` : null,
        estado === 'cancelled' ? 'Cancelada por el huésped'
          : estado === 'no_show' ? 'No se presentó' : null,
        // El no-show no devuelve nada, y eso se escribe en la fila.
        estado === 'no_show' ? 0 : null,
      ],
    )

    for (const [i, crudo] of e.pagos.entries()) {
      const p = comoPago(crudo)
      const bolivares = EN_BOLIVARES.has(p.metodo)
      const banco = BANCOS[(n + i) % BANCOS.length]

      await client.query(
        `insert into payments (
           booking_id, kind, method, status, currency, amount, amount_usd,
           rate_used, origin, reference, paid_at, reviewed_at,
           payer_name, payer_document, payer_bank, rejection_reason
         ) values (
           $1, $2, $3, $4, $5, $6::numeric, $7::numeric,
           $8::numeric, $9, $10, $11::timestamptz, $12::timestamptz,
           $13, $14, $15, $16
         )`,
        [
          booking.id,
          i === 0 ? 'deposit' : 'balance',
          p.metodo,
          p.estado,
          bolivares ? 'VES' : 'USD',
          bolivares ? Math.round(p.usd * tasa * 100) / 100 : p.usd,
          p.usd,
          bolivares ? tasa : null,
          bolivares ? e.tel : `${sinTildes(e.huesped.split(' ')[0])}@correo.com`,
          `${p.metodo === 'pago_movil' ? '00' : 'REF'}${String(100000 + n * 7 + i).slice(-6)}`,
          cobradoEl(e.in, i),
          p.estado === 'verifying' ? null : cobradoEl(e.in, i),
          e.huesped,
          e.doc,
          bolivares ? banco : null,
          p.motivo ?? null,
        ],
      )
    }

    if (e.devuelto) {
      const [metodo, importe] = e.devuelto
      await client.query(
        `insert into payments (
           booking_id, kind, method, status, currency, amount, amount_usd,
           reference, paid_at, reviewed_at, payer_name
         ) values ($1, 'refund', $2, 'refunded', 'USD', $3::numeric, $3::numeric, $4,
                   $5::timestamptz, $5::timestamptz, $6)`,
        [booking.id, metodo, importe, `DEV-${booking.code}`, `${e.in}T16:00:00Z`, e.huesped],
      )
    }
  }

  await client.query('commit')

  console.log(`sembradas ${ESTADIAS.length} reservas de prueba\n`)

  console.log('reservas por estado')
  console.table((await client.query(
    `select status, count(*)::int as n from bookings
      where guest_email like $1 group by 1 order by 2 desc`, [`%${MARCA}`],
  )).rows)

  console.log('pagos por estado')
  console.table((await client.query(
    `select p.status, count(*)::int as n, sum(p.amount_usd) as usd
       from payments p join bookings b on b.id = p.booking_id
      where b.guest_email like $1 group by 1 order by 2 desc`, [`%${MARCA}`],
  )).rows)

  console.log('ingresos')
  console.table((await client.query(
    `select month::text, charged_usd, refunded_usd, net_usd from revenue_by_month(4)`,
  )).rows)

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
