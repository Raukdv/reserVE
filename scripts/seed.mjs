// Datos de ejemplo para ver la app con contenido real.
//
//   node scripts/seed.mjs          -> siembra si está vacío
//   node scripts/seed.mjs --reset  -> borra lo sembrado y vuelve a sembrar
//
// Solo toca filas de ejemplo (slug con prefijo conocido). No borra reservas ni
// pagos reales.

import { readFileSync } from 'node:fs'
import pg from 'pg'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const RESET = process.argv.includes('--reset')

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
await client.query('begin')

try {
  if (RESET) {
    // Orden obligado por las claves foráneas: bookings.unit_id no cascadea, y
    // unit_holds.hold_id está en RESTRICT para que no se pueda borrar un hold
    // dejando la reserva sin fechas retenidas. Se va de dentro hacia fuera.
    const seededUnits = `
      select u.id from units u
      join properties p on p.id = u.property_id
      where p.slug = 'bahia-serena'`

    await client.query(
      `delete from payments where booking_id in (
         select id from bookings where unit_id in (${seededUnits}))`,
    )
    await client.query(`delete from bookings where unit_id in (${seededUnits})`)
    await client.query(`delete from properties where slug = 'bahia-serena'`)
    await client.query(`delete from site_content`)
    await client.query(`delete from payment_accounts`)
    console.log('  datos de ejemplo anteriores borrados')
  }

  const { rows: existing } = await client.query(
    `select id from properties where slug = 'bahia-serena'`,
  )
  if (existing.length) {
    console.log('  ya sembrado — usa --reset para rehacerlo')
    await client.query('rollback')
    await client.end()
    process.exit(0)
  }

  // --- Negocio ---------------------------------------------------------------

  await client.query(
    `update app_settings set
       business_name = 'Posada Bahía Serena',
       business_email = 'reservas@reserve.lngeneralservices.com',
       business_phone = '+58 414 901 2555',
       currency_display = 'both',
       default_deposit_ratio = 0.300,
       pending_ttl_hours = 24
     where id = true`,
  )

  const { rows: [property] } = await client.query(
    `insert into properties (name, slug, description, address, city, latitude, longitude)
     values (
       'Posada Bahía Serena', 'bahia-serena',
       'Posada frente al mar con seis habitaciones, terraza y desayuno incluido.',
       'Calle La Playa, sector Puerto Colombia', 'Choroní, Aragua',
       10.5069, -67.6006
     ) returning id`,
  )

  // --- Amenidades ------------------------------------------------------------

  const AMENITIES = [
    ['wifi', 'WiFi', 'wifi'],
    ['aire', 'Aire acondicionado', 'snowflake'],
    ['desayuno', 'Desayuno incluido', 'coffee'],
    ['piscina', 'Piscina', 'waves'],
    ['estacionamiento', 'Estacionamiento', 'car'],
    ['planta', 'Planta eléctrica', 'zap'],
    ['agua', 'Tanque de agua', 'droplet'],
    ['vista-mar', 'Vista al mar', 'sun'],
    ['cocina', 'Cocina equipada', 'chef-hat'],
    ['tv', 'TV por cable', 'tv'],
  ]

  const amenityIds = {}
  for (const [slug, label, icon] of AMENITIES) {
    const { rows: [a] } = await client.query(
      `insert into amenities (slug, label, icon) values ($1, $2, $3)
       on conflict (slug) do update set label = excluded.label
       returning id`,
      [slug, label, icon],
    )
    amenityIds[slug] = a.id
  }

  // --- Unidades --------------------------------------------------------------

  const UNITS = [
    {
      name: 'Habitación Coral',
      slug: 'coral',
      cleaning: 10,
      description:
        'Habitación matrimonial con vista parcial al mar, baño privado y aire acondicionado. '
        + 'Ideal para parejas.',
      max_guests: 2, bedrooms: 1, beds: 1, bathrooms: 1,
      base_price_usd: 45, min_nights: 2,
      amenities: ['wifi', 'aire', 'desayuno', 'vista-mar', 'planta', 'agua'],
    },
    {
      name: 'Habitación Manglar',
      slug: 'manglar',
      cleaning: 10,
      description:
        'Habitación doble con dos camas individuales y ventana al jardín interior. '
        + 'Tranquila y fresca.',
      max_guests: 3, bedrooms: 1, beds: 2, bathrooms: 1,
      base_price_usd: 38, min_nights: 2,
      amenities: ['wifi', 'aire', 'desayuno', 'planta', 'agua'],
    },
    {
      name: 'Suite Bahía',
      slug: 'suite-bahia',
      cleaning: 15,
      description:
        'Suite con terraza privada frente al mar, sala de estar, minibar y baño en mármol. '
        + 'La mejor vista de la posada.',
      max_guests: 4, bedrooms: 1, beds: 2, bathrooms: 1.5,
      base_price_usd: 85, min_nights: 2,
      amenities: ['wifi', 'aire', 'desayuno', 'vista-mar', 'piscina', 'planta', 'agua', 'tv'],
    },
    {
      name: 'Apartamento Ceiba',
      slug: 'ceiba',
      cleaning: 25,
      description:
        'Apartamento independiente de dos habitaciones con cocina equipada y patio. '
        + 'Pensado para familias o estadías largas.',
      max_guests: 6, bedrooms: 2, beds: 3, bathrooms: 2,
      base_price_usd: 110, min_nights: 3,
      amenities: ['wifi', 'aire', 'cocina', 'estacionamiento', 'piscina', 'planta', 'agua', 'tv'],
    },
  ]

  const unitIds = {}
  for (const [i, u] of UNITS.entries()) {
    const { rows: [unit] } = await client.query(
      `insert into units (
         property_id, name, slug, description, max_guests, bedrooms, beds, bathrooms,
         base_price_usd, min_nights, advance_notice_days,
         is_published, sort_order
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,true,$11)
       returning id`,
      [property.id, u.name, u.slug, u.description, u.max_guests, u.bedrooms, u.beds,
       u.bathrooms, u.base_price_usd, u.min_nights, i],
    )
    unitIds[u.slug] = unit.id

    // La limpieza es un cargo, no una columna de la unidad.
    if (u.cleaning) {
      await client.query(
        `insert into fees (unit_id, name, kind, amount, refundable, sort_order)
         values ($1, 'Limpieza', 'fixed', $2, false, 0)`,
        [unit.id, u.cleaning],
      )
    }

    for (const a of u.amenities) {
      await client.query(
        `insert into unit_amenities (unit_id, amenity_id) values ($1, $2)`,
        [unit.id, amenityIds[a]],
      )
    }
  }

  // --- Temporadas ------------------------------------------------------------

  const year = new Date().getUTCFullYear()
  for (const slug of Object.keys(unitIds)) {
    const base = UNITS.find((u) => u.slug === slug).base_price_usd
    await client.query(
      `insert into season_rates (unit_id, name, period, price_usd, min_nights) values
         ($1, 'Temporada alta — Carnaval', daterange($2, $3, '[)'), $4, 3),
         ($1, 'Temporada alta — Semana Santa', daterange($5, $6, '[)'), $7, 3),
         ($1, 'Temporada alta — Diciembre', daterange($8, $9, '[)'), $10, 4)`,
      [
        unitIds[slug],
        `${year + 1}-02-14`, `${year + 1}-02-19`, Math.round(base * 1.4),
        `${year + 1}-03-29`, `${year + 1}-04-06`, Math.round(base * 1.4),
        `${year}-12-20`, `${year + 1}-01-07`, Math.round(base * 1.6),
      ],
    )
  }

  // --- Bloqueos y una reserva de ejemplo -------------------------------------

  const { rows: [blockHold] } = await client.query(
    `insert into unit_holds (unit_id, stay, kind)
     values ($1, daterange(current_date + 10, current_date + 14, '[)'), 'block')
     returning id`,
    [unitIds['suite-bahia']],
  )
  await client.query(
    `insert into availability_blocks (hold_id, reason) values ($1, 'Mantenimiento de aire')`,
    [blockHold.id],
  )

  const { rows: [bookHold] } = await client.query(
    `insert into unit_holds (unit_id, stay, kind)
     values ($1, daterange(current_date + 20, current_date + 24, '[)'), 'booking')
     returning id`,
    [unitIds['coral']],
  )
  const rate = (await client.query('select current_rate() as r')).rows[0].r
  const totalUsd = 45 * 4 + 10
  const { rows: [booking] } = await client.query(
    `insert into bookings (
       unit_id, hold_id, status, check_in, check_out, guests,
       guest_name, guest_email, guest_phone, guest_document,
       subtotal_usd, total_usd,
       rate_snapshot, rate_date, total_ves, deposit_ratio
     ) values (
       $1, $2, 'pending', current_date + 20, current_date + 24, 2,
       'María Rodríguez', 'maria.rodriguez@example.com', '+58 412 555 0134', 'V-18456789',
       $3, 10, $4, $5, current_rate_date(), $6, 0.300
     ) returning id, code`,
    [unitIds['coral'], bookHold.id, 45 * 4, totalUsd, rate, (totalUsd * rate).toFixed(2)],
  )

  await client.query(
    `insert into payments (
       booking_id, kind, method, status, currency, amount, amount_usd, rate_used,
       origin, reference, paid_at, payer_name, payer_document
     ) values (
       $1, 'deposit', 'zelle', 'verifying', 'USD', $2, $2, null,
       'maria.rodriguez@example.com', 'ZL-8842019', now() - interval '2 hours',
       'Maria Rodriguez', 'V-18456789'
     )`,
    [booking.id, (totalUsd * 0.3).toFixed(2)],
  )

  // --- Cargos generales ------------------------------------------------------

  await client.query(`delete from fees where unit_id is null`)
  await client.query(
    `insert into fees (unit_id, name, kind, amount, description, sort_order)
     values (null, 'IVA', 'percent', 16,
             'Impuesto al valor agregado sobre el total del servicio.', 10)`,
  )

  // --- Cuentas de cobro ------------------------------------------------------

  // Sin estos datos el huésped no sabe a dónde pagar y el flujo se corta.
  await client.query(`delete from payment_accounts`)
  await client.query(
    `insert into payment_accounts (method, label, holder, document, bank, identifier, instructions, sort_order) values
       ('pago_movil', 'Pago Móvil Banesco', 'Posada Bahía Serena C.A.', 'J-40123456-7', 'Banesco (0134)', '0414 901 2555',
        'Indica el número de referencia completo al reportar.', 0),
       ('transferencia', 'Cuenta corriente Banesco', 'Posada Bahía Serena C.A.', 'J-40123456-7', 'Banesco',
        '0134-0000-00-0000000000', 'Transferencia en bolívares a tasa BCV del día.', 1),
       ('zelle', 'Zelle', 'Raul Diaz', null, null, 'reservas@lngeneralservices.com',
        'Coloca el código de tu reserva en el concepto.', 2),
       ('binance', 'Binance Pay', 'Posada Bahía Serena', null, null, 'bahiaserena',
        'Envío por Binance Pay, sin comisión.', 3),
       ('usdt', 'USDT · red TRON (TRC20)', null, null, null, 'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        'Solo red TRC20. Envíos por otra red se pierden.', 4)`,
  )

  // --- Contenido del home ----------------------------------------------------

  const CONTENT = {
    hero: {
      title: 'Frente al mar, en Choroní',
      subtitle:
        'Seis habitaciones, terraza sobre la bahía y desayuno incluido. '
        + 'Consulta disponibilidad y reserva tus fechas en línea.',
      cta: 'Ver disponibilidad',
    },
    about: {
      title: 'Sobre la posada',
      body:
        'Bahía Serena es una posada familiar a dos minutos caminando de la playa de Puerto Colombia. '
        + 'Abrimos en 2011 y desde entonces atendemos personalmente a cada huésped.\n\n'
        + 'La casa tiene patio interno con ceiba, terraza en el segundo piso con vista a la bahía, '
        + 'y una cocina donde servimos el desayuno todas las mañanas entre 7:30 y 10:00.',
    },
    services: {
      title: 'Servicios',
      items: [
        { label: 'Desayuno criollo incluido', detail: 'Arepas, empanadas, café y fruta de temporada.' },
        { label: 'Planta eléctrica', detail: 'Respaldo automático en toda la posada.' },
        { label: 'Tanque y bomba de agua', detail: 'Suministro continuo las 24 horas.' },
        { label: 'Estacionamiento privado', detail: 'Dentro de la propiedad, sin costo.' },
        { label: 'Excursiones', detail: 'Coordinamos lancha a Cepe, Chuao y Playa Grande.' },
        { label: 'Traslados', detail: 'Desde Maracay o el aeropuerto de Maiquetía, bajo pedido.' },
      ],
    },
    location: {
      title: 'Cómo llegar',
      body:
        'Estamos en el sector Puerto Colombia, Choroní, estado Aragua. '
        + 'Desde Maracay son unas dos horas por la carretera de la montaña, atravesando el Parque '
        + 'Nacional Henri Pittier.',
      address: 'Calle La Playa, Puerto Colombia, Choroní, Aragua',
    },
    faq: {
      title: 'Preguntas frecuentes',
      items: [
        {
          q: '¿Cómo confirmo mi reserva?',
          a: 'Se confirma con un anticipo del 30%. Puedes pagar por Pago Móvil, transferencia, '
             + 'Zelle, Binance o PayPal. Reportas el comprobante desde la misma página de la reserva '
             + 'y nosotros lo verificamos, normalmente el mismo día.',
        },
        {
          q: '¿En qué moneda son los precios?',
          a: 'Las tarifas se publican en dólares como referencia. Si pagas por un canal nacional, '
             + 'el monto en bolívares se calcula con la tasa BCV del día de la reserva y queda fijo.',
        },
        {
          q: '¿Cuál es la política de cancelación?',
          a: 'Cancelación gratuita hasta 7 días antes de la llegada. Entre 7 y 3 días se retiene '
             + 'el 50% del anticipo. Con menos de 3 días, el anticipo no es reembolsable.',
        },
        {
          q: '¿A qué hora son la entrada y la salida?',
          a: 'Entrada desde la 1:00 p.m. y salida hasta las 11:00 a.m. Si necesitas otro horario, '
             + 'escríbenos y lo acomodamos según la ocupación.',
        },
        {
          q: '¿Aceptan niños y mascotas?',
          a: 'Niños de todas las edades, sí. Mascotas pequeñas en el Apartamento Ceiba, avisando '
             + 'con antelación.',
        },
      ],
    },
    contact: {
      title: 'Contacto',
      body: 'Escríbenos por WhatsApp o correo. Respondemos entre 8:00 a.m. y 8:00 p.m.',
    },
  }

  for (const [key, data] of Object.entries(CONTENT)) {
    await client.query(
      `insert into site_content (key, data) values ($1, $2)
       on conflict (key) do update set data = excluded.data, updated_at = now()`,
      [key, JSON.stringify(data)],
    )
  }

  await client.query('commit')
  console.log(`  posada + ${UNITS.length} unidades + tarifas + 1 reserva pendiente`)
  console.log(`  reserva de ejemplo: ${booking.code} (pago Zelle por verificar)`)
  console.log('Sembrado.')
} catch (err) {
  await client.query('rollback')
  console.error('Falló, nada se escribió:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
