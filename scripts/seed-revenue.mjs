/**
 * Un lote pequeño de reservas de prueba: junio, julio y agosto de 2026.
 *
 *   pnpm seed:revenue
 *   node --env-file=.env.local scripts/seed-revenue.mjs --limpiar
 *
 * ## Qué monta
 *
 * Treinta estadías repartidas entre las veinte unidades y los tres meses, con
 * lo justo para que **Reservas**, **Pagos** e **Ingresos** tengan algo que
 * enseñar:
 *
 * - Veintiséis cobradas y cerradas, dos de ellas con saldo pendiente.
 * - Dos canceladas con devolución: una entera y otra a medias.
 * - Dos con el comprobante reportado y sin verificar — la bandeja de Pagos.
 *
 * Una lista escrita a mano y no un generador. A esta escala el generador solo
 * añade una capa que hay que leer para saber qué hay en la base; treinta filas
 * se auditan de un vistazo.
 *
 * **Sin comprobantes.** `receipt_path` va nulo: el bucket es privado y subir
 * imágenes de prueba no aporta nada. La ficha de verificación ya contempla que
 * no haya captura.
 *
 * **Sin IVA.** No se toca `app_settings.vat_enabled` ni se crea ningún cargo
 * marcado como impuesto.
 *
 * ## El mes es el del cobro, no el de la estadía
 *
 * `revenue_by_month()` agrupa por `paid_at`, que es lo correcto: el dinero entró
 * cuando entró. El anticipo se cobra unos días antes de la entrada, sin salirse
 * de su mes, para que las tres barras queden pobladas.
 *
 * ## Por qué inserta a mano y no llama a `create_booking()`
 *
 * Esa función rechaza fechas pasadas —comprueba `advance_notice_days` y devuelve
 * `too_soon`—, correcto para una reserva de verdad e inservible para sembrar
 * histórico. Se escriben las filas directamente, incluida la retención en
 * `unit_holds`, que es lo que ocupa el calendario e impide el solape.
 *
 * ## Cómo se reconoce y se borra
 *
 * Todas las reservas llevan correo `@seed.local`. `--limpiar` borra esas y sus
 * retenciones; los pagos se van solos por la cascada. Nada más se toca — ni las
 * unidades, ni los ajustes, ni ninguna reserva de verdad.
 */
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

const MARCA = '@seed.local'

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

/** Tasa BCV plausible de cada mes. Se congela en la reserva, como en producción. */
const TASA = { '2026-06': 706.8, '2026-07': 742.18, '2026-08': 779.95 }

/** Métodos que se cobran en bolívares. El resto van en divisas. */
const EN_BOLIVARES = new Set(['pago_movil', 'c2p', 'transferencia'])

const BANCOS = ['Banesco', 'Mercantil', 'Provincial', 'Venezuela', 'BNC']

/**
 * Las treinta estadías.
 *
 * `pagos` acepta `[metodo, importeUSD]` o un objeto con `estado`. Sin `estado`,
 * el cobro está aprobado. El importe es lo que se cobró: si no llega al total de
 * la estadía queda saldo pendiente, que también es un caso que hay que ver.
 *
 * Las fechas no se solapan dentro de una misma unidad. Con veinte unidades y
 * treinta estadías sobra sitio, pero el `EXCLUDE` de `unit_holds` lo rechazaría
 * igual: es su trabajo.
 */
const ESTADIAS = [
  // ------------------------------------------------------------------ Junio
  { unidad: 'prueba-habitacion-brisa',   in: '2026-06-03', out: '2026-06-06', huesped: 'Ana Rivas',        doc: 'V-14235678', tel: '+584121234567', pagos: [['zelle', 195]] },
  { unidad: 'prueba-casa-palmar',        in: '2026-06-05', out: '2026-06-09', huesped: 'Familia Perdomo',  doc: 'V-9876543',  tel: '+584241234567', pagos: [['transferencia', 1120]] },
  { unidad: 'prueba-cabana-uvero',       in: '2026-06-08', out: '2026-06-11', huesped: 'Luis Betancourt',  doc: 'V-18445221', tel: '+584161234567', pagos: [['pago_movil', 345]] },
  { unidad: 'prueba-suite-amanecer',     in: '2026-06-12', out: '2026-06-16', huesped: 'Carmen Ochoa',     doc: 'V-11223344', tel: '+584141234567', pagos: [['binance', 760]] },
  // Anticipo cobrado, saldo pendiente: 240 de 800.
  { unidad: 'jardin',                    in: '2026-06-15', out: '2026-06-19', huesped: 'Jorge Salcedo',    doc: 'V-7654321',  tel: '+584121112233', pagos: [['zelle', 240]] },
  { unidad: 'prueba-habitacion-luna',    in: '2026-06-18', out: '2026-06-21', huesped: 'Marta Guillén',    doc: 'E-84551200', tel: '+584129998877', pagos: [['usdt', 240]] },
  { unidad: 'prueba-bungalow-tortuga',   in: '2026-06-20', out: '2026-06-25', huesped: 'Grupo Anzoátegui', doc: 'J-305430170', tel: '+584125556677', pagos: [['transferencia', 825]] },
  { unidad: 'prueba-habitacion-caracol', in: '2026-06-23', out: '2026-06-26', huesped: 'Pedro Rondón',     doc: 'V-16778899', tel: '+584143334455', pagos: [['efectivo', 216]] },
  // Cancelada tras cobrar: devolución completa.
  { unidad: 'prueba-cabana-mangle',      in: '2026-06-26', out: '2026-06-29', huesped: 'Elena Vargas',     doc: 'V-20114455', tel: '+584161239876', pagos: [['zelle', 375]], devuelto: ['zelle', 375], estado: 'cancelled' },
  { unidad: 'prueba-suite-mar',          in: '2026-06-27', out: '2026-06-30', huesped: 'Andrés Molina',    doc: 'V-13445566', tel: '+584247778899', pagos: [['pago_movil', 360]] },

  // ------------------------------------------------------------------ Julio
  { unidad: 'prueba-habitacion-arena',   in: '2026-07-02', out: '2026-07-06', huesped: 'Yolanda Mejías',   doc: 'V-10556677', tel: '+584122223344', pagos: [['pago_movil', 280]] },
  { unidad: 'prueba-casa-mirador',       in: '2026-07-04', out: '2026-07-09', huesped: 'Congreso Mérida',  doc: 'J-410992384', tel: '+584122228899', pagos: [['transferencia', 1700]] },
  { unidad: 'prueba-bungalow-coral',     in: '2026-07-07', out: '2026-07-11', huesped: 'Sofía Delgado',    doc: 'V-22334455', tel: '+584126667788', pagos: [['zelle', 620]] },
  { unidad: 'prueba-cabana-cocotero',    in: '2026-07-10', out: '2026-07-14', huesped: 'Óscar Lares',      doc: 'V-8899001',  tel: '+584241119900', pagos: [['efectivo', 520]] },
  { unidad: 'prueba-habitacion-sol',     in: '2026-07-13', out: '2026-07-16', huesped: 'Verónica Silva',   doc: 'V-19002233', tel: '+584165554433', pagos: [['binance', 234]] },
  { unidad: 'prueba-casa-brisa',         in: '2026-07-15', out: '2026-07-20', huesped: 'Familia Urdaneta', doc: 'V-12009988', tel: '+584143332211', pagos: [['transferencia', 800], ['efectivo', 800]] },
  { unidad: 'prueba-suite-atardecer',    in: '2026-07-18', out: '2026-07-22', huesped: 'Hugo Peñalver',    doc: 'V-17334455', tel: '+584122229988', pagos: [['usdt', 820]] },
  { unidad: 'prueba-cabana-almendron',   in: '2026-07-21', out: '2026-07-25', huesped: 'Nelson Rivero',    doc: 'V-14778800', tel: '+584161112233', pagos: [['pago_movil', 440]] },
  // Cancelada con penalización: se devuelve la mitad.
  { unidad: 'prueba-bungalow-palmera',   in: '2026-07-24', out: '2026-07-27', huesped: 'Daniela Paredes',  doc: 'V-19445566', tel: '+584161114455', pagos: [['usdt', 540]], devuelto: ['usdt', 270], estado: 'cancelled' },
  // Anticipo cobrado, saldo pendiente: 300 de 300... completa.
  { unidad: 'prueba-habitacion-coral',   in: '2026-07-27', out: '2026-07-31', huesped: 'Gabriel Antón',    doc: 'V-21556677', tel: '+584125558811', pagos: [['zelle', 300]] },

  // ----------------------------------------------------------------- Agosto
  { unidad: 'prueba-habitacion-brisa',   in: '2026-08-02', out: '2026-08-06', huesped: 'Lucía Bermúdez',   doc: 'V-18990011', tel: '+584247774455', pagos: [['efectivo', 260]] },
  { unidad: 'prueba-casa-palmar',        in: '2026-08-04', out: '2026-08-09', huesped: 'Isabel Castro',    doc: 'V-16223344', tel: '+584143336677', pagos: [['transferencia', 1400]] },
  { unidad: 'prueba-cabana-uvero',       in: '2026-08-07', out: '2026-08-11', huesped: 'Ramón Quintero',   doc: 'V-9112233',  tel: '+584129994455', pagos: [['binance', 460]] },
  { unidad: 'jardin',                    in: '2026-08-09', out: '2026-08-13', huesped: 'Rafael Nieves',    doc: 'V-20445566', tel: '+584161117788', pagos: [['zelle', 400], ['efectivo', 400]] },
  { unidad: 'prueba-suite-amanecer',     in: '2026-08-12', out: '2026-08-16', huesped: 'Patricia Rojas',   doc: 'V-13889900', tel: '+584241113344', pagos: [['zelle', 760]] },
  { unidad: 'prueba-habitacion-luna',    in: '2026-08-14', out: '2026-08-18', huesped: 'Simón Alcalá',     doc: 'V-17009911', tel: '+584125552211', pagos: [['pago_movil', 320]] },
  { unidad: 'prueba-bungalow-tortuga',   in: '2026-08-17', out: '2026-08-21', huesped: 'Teresa Villegas',  doc: 'V-11667788', tel: '+584143339900', pagos: [['transferencia', 660]] },
  // Hospedada ahora mismo: el estado sale de las fechas contra business_today().
  { unidad: 'prueba-suite-atardecer',    in: '2026-08-23', out: '2026-08-27', huesped: 'Marisol Guédez',   doc: 'V-22889900', tel: '+584241115566', pagos: [['zelle', 820]] },

  // Pendientes con el comprobante reportado y sin verificar: la bandeja de Pagos.
  {
    unidad: 'prueba-cabana-mangle', in: '2026-08-28', out: '2026-08-31',
    huesped: 'Rosa Delgado', doc: 'V-16334455', tel: '+584122227733', estado: 'pending',
    pagos: [{ metodo: 'pago_movil', usd: 112.5, estado: 'verifying' }],
  },
  {
    unidad: 'prueba-bungalow-coral', in: '2026-08-29', out: '2026-08-31',
    huesped: 'Iván Márquez', doc: 'V-20778899', tel: '+584241114477', estado: 'pending',
    pagos: [{ metodo: 'zelle', usd: 93, estado: 'verifying' }],
  },
]

const mesDe = (fecha) => fecha.slice(0, 7)

/**
 * Cuándo se cobró: el anticipo unos días antes de entrar, el saldo al llegar.
 *
 * Limitado al día 1 del mes de la entrada. `revenue_by_month()` agrupa por fecha
 * de cobro, y con la antelación de verdad —semanas— casi todo el mes se contaría
 * en el anterior.
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
    console.error('¿falta correr scripts/seed-units.mjs?')
    process.exit(1)
  }

  const { rows: [ya] } = await client.query(
    `select count(*)::int as n from bookings where guest_email like $1`, [`%${MARCA}`],
  )
  if (ya.n > 0) {
    console.error(`ya hay ${ya.n} reservas de prueba. Corre --limpiar antes de volver a sembrar.`)
    process.exit(1)
  }

  /*
    Se arma todo en memoria y se escribe en tres insertos.

    Los identificadores se generan aquí y no se leen de un `returning`: hacen
    falta antes de insertar, porque el pago necesita el `booking_id` y la reserva
    el `hold_id`. Un `returning` masivo devolvería las filas sin garantía de
    orden, y emparejarlas por posición sería confiar en algo que Postgres no
    promete.
  */
  const holds = { id: [], unidad: [], entrada: [], salida: [], activo: [] }
  const reservas = {
    id: [], hold: [], unidad: [], estado: [], entrada: [], salida: [],
    nombre: [], correo: [], telefono: [], documento: [],
    subtotal: [], tasa: [], creada: [], expira: [], cancelada: [], motivo: [],
  }
  const cobros = {
    reserva: [], clase: [], metodo: [], estado: [], moneda: [],
    importe: [], usd: [], tasaUsada: [], origen: [], referencia: [],
    pagado: [], revisado: [], pagador: [], documento: [], banco: [], rechazo: [],
  }

  for (const [n, e] of ESTADIAS.entries()) {
    const unidad = porSlug.get(e.unidad)
    const noches = (new Date(e.out) - new Date(e.in)) / 86_400_000
    const subtotal = Number(unidad.base_price_usd) * noches
    const tasa = TASA[mesDe(e.in)]

    // El estado sale de las fechas salvo que se fuerce: así el seed no envejece
    // mal y «hospedada ahora mismo» sigue siéndolo mañana.
    const estado =
      e.estado ??
      (e.out <= hoy ? 'completed' : e.in <= hoy ? 'checked_in' : 'confirmed')

    // La retención sigue activa mientras la reserva viva. Una cancelada la
    // libera; el EXCLUDE lleva `where (is_active)`, así que puede solaparse con
    // una estadía viva sin chocar.
    const viva = ['completed', 'checked_in', 'confirmed', 'pending'].includes(estado)

    const holdId = randomUUID()
    const reservaId = randomUUID()

    holds.id.push(holdId)
    holds.unidad.push(unidad.id)
    holds.entrada.push(e.in)
    holds.salida.push(e.out)
    holds.activo.push(viva)

    reservas.id.push(reservaId)
    reservas.hold.push(holdId)
    reservas.unidad.push(unidad.id)
    reservas.estado.push(estado)
    reservas.entrada.push(e.in)
    reservas.salida.push(e.out)
    reservas.nombre.push(e.huesped)
    reservas.correo.push(`huesped${n + 1}${MARCA}`)
    reservas.telefono.push(e.tel)
    reservas.documento.push(e.doc)
    reservas.subtotal.push(subtotal)
    reservas.tasa.push(tasa)
    reservas.creada.push(`${e.in}T09:00:00Z`)
    reservas.expira.push(estado === 'pending' ? `${hoy}T23:00:00Z` : null)
    reservas.cancelada.push(estado === 'cancelled' ? `${e.in}T10:00:00Z` : null)
    reservas.motivo.push(estado === 'cancelled' ? 'Cancelada por el huésped' : null)

    for (const [i, crudo] of e.pagos.entries()) {
      const pago = comoPago(crudo)
      const bolivares = EN_BOLIVARES.has(pago.metodo)

      cobros.reserva.push(reservaId)
      cobros.clase.push(i === 0 ? 'deposit' : 'balance')
      cobros.metodo.push(pago.metodo)
      cobros.estado.push(pago.estado)
      cobros.moneda.push(bolivares ? 'VES' : 'USD')
      cobros.importe.push(bolivares ? Math.round(pago.usd * tasa * 100) / 100 : pago.usd)
      cobros.usd.push(pago.usd)
      cobros.tasaUsada.push(bolivares ? tasa : null)
      cobros.origen.push(
        bolivares ? e.tel : `${sinTildes(e.huesped.split(' ')[0])}@correo.com`,
      )
      cobros.referencia.push(
        `${pago.metodo === 'pago_movil' ? '00' : 'REF'}${String(100000 + n * 7 + i).slice(-6)}`,
      )
      cobros.pagado.push(cobradoEl(e.in, i))
      // Lo que espera verificación todavía no lo ha mirado nadie.
      cobros.revisado.push(pago.estado === 'verifying' ? null : cobradoEl(e.in, i))
      cobros.pagador.push(e.huesped)
      cobros.documento.push(e.doc)
      cobros.banco.push(bolivares ? BANCOS[(n + i) % BANCOS.length] : null)
      cobros.rechazo.push(null)
    }

    if (e.devuelto) {
      const [metodo, importe] = e.devuelto

      cobros.reserva.push(reservaId)
      cobros.clase.push('refund')
      cobros.metodo.push(metodo)
      cobros.estado.push('refunded')
      cobros.moneda.push('USD')
      cobros.importe.push(importe)
      cobros.usd.push(importe)
      cobros.tasaUsada.push(null)
      cobros.origen.push(null)
      cobros.referencia.push(`DEV-${String(n).padStart(4, '0')}`)
      cobros.pagado.push(`${e.in}T16:00:00Z`)
      cobros.revisado.push(`${e.in}T16:00:00Z`)
      cobros.pagador.push(e.huesped)
      cobros.documento.push(e.doc)
      cobros.banco.push(null)
      cobros.rechazo.push(null)
    }
  }

  await client.query('begin')

  await client.query(
    `insert into unit_holds (id, unit_id, stay, kind, is_active)
     select id, unidad, daterange(entrada, salida, '[)'), 'booking', activo
       from unnest($1::uuid[], $2::uuid[], $3::date[], $4::date[], $5::boolean[])
         as t(id, unidad, entrada, salida, activo)`,
    [holds.id, holds.unidad, holds.entrada, holds.salida, holds.activo],
  )

  await client.query(
    `insert into bookings (
       id, hold_id, unit_id, status, check_in, check_out, guests,
       guest_name, guest_email, guest_phone, guest_document,
       subtotal_usd, total_usd, rate_snapshot, rate_date, total_ves,
       deposit_ratio, created_at, expires_at, cancelled_at, cancel_reason
     )
     select
       id, hold, unidad, estado::booking_status, entrada, salida, 2,
       nombre, correo, telefono, documento,
       subtotal, subtotal, tasa, entrada, round(subtotal * tasa, 2),
       0.3, creada, expira, cancelada, motivo
     from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::date[], $6::date[],
       $7::text[], $8::text[], $9::text[], $10::text[],
       $11::numeric[], $12::numeric[], $13::timestamptz[], $14::timestamptz[],
       $15::timestamptz[], $16::text[]
     ) as t(
       id, hold, unidad, estado, entrada, salida,
       nombre, correo, telefono, documento,
       subtotal, tasa, creada, expira, cancelada, motivo
     )`,
    [
      reservas.id, reservas.hold, reservas.unidad, reservas.estado,
      reservas.entrada, reservas.salida, reservas.nombre, reservas.correo,
      reservas.telefono, reservas.documento, reservas.subtotal, reservas.tasa,
      reservas.creada, reservas.expira, reservas.cancelada, reservas.motivo,
    ],
  )

  await client.query(
    `insert into payments (
       booking_id, kind, method, status, currency, amount, amount_usd,
       rate_used, origin, reference, paid_at, reviewed_at,
       payer_name, payer_document, payer_bank, rejection_reason
     )
     select
       reserva, clase::payment_kind, metodo::payment_method, estado::payment_status,
       moneda, importe, usd, tasa, origen, referencia, pagado, revisado,
       pagador, documento, banco, rechazo
     from unnest(
       $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[],
       $6::numeric[], $7::numeric[], $8::numeric[], $9::text[], $10::text[],
       $11::timestamptz[], $12::timestamptz[], $13::text[], $14::text[],
       $15::text[], $16::text[]
     ) as t(
       reserva, clase, metodo, estado, moneda, importe, usd, tasa,
       origen, referencia, pagado, revisado, pagador, documento, banco, rechazo
     )`,
    [
      cobros.reserva, cobros.clase, cobros.metodo, cobros.estado, cobros.moneda,
      cobros.importe, cobros.usd, cobros.tasaUsada, cobros.origen,
      cobros.referencia, cobros.pagado, cobros.revisado, cobros.pagador,
      cobros.documento, cobros.banco, cobros.rechazo,
    ],
  )

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
    `select month::text as mes, charged_usd as cobrado, refunded_usd as devuelto,
            net_usd as ingreso
       from revenue_by_month(4)`,
  )).rows)
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
