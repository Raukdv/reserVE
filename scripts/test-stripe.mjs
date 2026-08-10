// Prueba del cobro con tarjeta sin depender de la CLI de Stripe.
//
//   node scripts/test-stripe.mjs [--url=http://localhost:3000]
//
// Hace dos cosas distintas:
//
//   1. Crea una sesión de checkout REAL contra la API de Stripe con la clave de
//      sandbox. Verifica que la clave sirve y que la sesión sale bien formada.
//   2. Firma un evento `checkout.session.completed` con el mismo secreto que usa
//      el servidor y lo entrega al webhook. Verifica firma, registro del cobro,
//      confirmación de la reserva, idempotencia y correo.
//
// Lo único que no cubre es el paso por la página alojada de Stripe, que exige un
// navegador. Para eso hace falta la CLI:
//   stripe listen --forward-to localhost:3000/api/webhooks/stripe
//
// Deja la base como la encontró.

import { readFileSync } from 'node:fs'
import pg from 'pg'
import Stripe from 'stripe'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}

const base =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:3000'
const webhookUrl = `${base.replace(/\/$/, '')}/api/webhooks/stripe`

const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env
if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.error('Faltan STRIPE_SECRET_KEY o STRIPE_WEBHOOK_SECRET en .env.local')
  process.exit(1)
}

if (!STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  console.error('ABORTADO: la clave no es de sandbox. Esta prueba no se corre contra dinero real.')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY)
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const q = async (sql, params) => (await db.query(sql, params)).rows

const post = (body, signature) =>
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  })

await db.connect()

let code = null
let holdId = null

try {
  // --- Reserva de prueba ----------------------------------------------------

  const [unit] = await q(`select id, name from units where is_published order by sort_order limit 1`)
  if (!unit) throw new Error('no hay unidades publicadas')

  const [{ r: created }] = await q(
    `select create_booking($1, business_today() + 60, business_today() + 64, 2,
       'Prueba Stripe', 'stripe-test@example.com', null, null, null) as r`,
    [unit.id],
  )
  if (!created.ok) throw new Error(`no se pudo crear la reserva: ${created.error}`)

  code = created.code
  ;[{ hold_id: holdId }] = await q(`select hold_id from bookings where code = $1`, [code])
  console.log(`  reserva ${code} · total ${created.total_usd} · anticipo ${created.deposit_usd}\n`)

  // --- 1. Sesión real contra la API de Stripe -------------------------------

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    client_reference_id: code,
    metadata: { booking_code: code },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(created.deposit_usd * 100),
          product_data: { name: unit.name, description: `Reserva ${code}` },
        },
      },
    ],
    success_url: 'https://example.com/ok',
    cancel_url: 'https://example.com/no',
  })

  check('la clave de sandbox crea la sesión', Boolean(session.id), session.id)
  check('la sesión no es de modo real', session.livemode === false)
  check(
    'el importe coincide con el anticipo',
    session.amount_total === Math.round(created.deposit_usd * 100),
    `${session.amount_total} centavos`,
  )
  check('lleva el código de la reserva', session.client_reference_id === code)

  // --- 2. Webhook -----------------------------------------------------------

  const event = {
    id: `evt_test_${Date.now()}`,
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { ...session, payment_status: 'paid' } },
  }
  const payload = JSON.stringify(event)
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET,
  })

  // Firma inválida: es lo que impide que cualquiera que descubra la URL se
  // confirme reservas gratis.
  const forged = await post(payload, 't=1,v1=firmafalsa')
  check('rechaza firma inválida', forged.status === 400, `HTTP ${forged.status}`)

  const sinFirma = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  })
  check('rechaza petición sin firma', sinFirma.status === 400, `HTTP ${sinFirma.status}`)

  const first = await post(payload, signature)
  const firstBody = await first.json()
  check('acepta el evento firmado', first.status === 200, JSON.stringify(firstBody))
  check('no lo marca como duplicado', firstBody.duplicate === false)
  check('confirma la reserva', firstBody.confirmed === true)

  const [booking] = await q(`select status from bookings where code = $1`, [code])
  check('la reserva queda confirmada en la base', booking.status === 'confirmed', booking.status)

  const payments = await q(
    `select status, provider, provider_ref, amount_usd, method
     from payments where booking_id = (select id from bookings where code = $1)`,
    [code],
  )
  check('registra un pago aprobado', payments.length === 1 && payments[0].status === 'approved')
  check('lo marca como cobro de Stripe', payments[0]?.provider === 'stripe')
  check('guarda la referencia de la sesión', payments[0]?.provider_ref === session.id)

  // Stripe reintenta hasta recibir un 2xx: el mismo evento llega varias veces.
  const again = await post(payload, signature)
  const againBody = await again.json()
  check('el reintento responde 200', again.status === 200)
  check('lo detecta como duplicado', againBody.duplicate === true)

  const afterRetry = await q(
    `select count(*)::int n from payments
     where booking_id = (select id from bookings where code = $1)`,
    [code],
  )
  check('no cobra dos veces', afterRetry[0].n === 1, `${afterRetry[0].n} pagos`)

  const emails = await q(
    `select kind, ok from email_log where booking_id = (select id from bookings where code = $1)`,
    [code],
  )
  const approvals = emails.filter((e) => e.kind === 'payment_approved')
  check('avisa al huésped una sola vez', approvals.length === 1, `${approvals.length} correos`)
} catch (err) {
  console.error('\nERROR:', err.message)
  failures++
} finally {
  // --- Limpieza -------------------------------------------------------------
  if (code) {
    await db.query('begin')
    await db.query(
      `delete from email_log where booking_id = (select id from bookings where code = $1)`,
      [code],
    )
    await db.query(
      `delete from payments where booking_id = (select id from bookings where code = $1)`,
      [code],
    )
    await db.query(`delete from bookings where code = $1`, [code])
    if (holdId) await db.query(`delete from unit_holds where id = $1`, [holdId])
    await db.query('commit')
    console.log(`\n  reserva de prueba ${code} eliminada`)
  }
  await db.end()
}

console.log(failures ? `\n${failures} comprobación(es) fallida(s)` : '\nTodo correcto')
process.exit(failures ? 1 : 0)
